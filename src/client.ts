// Copyright (c) 2019-2021 Jan Janak <jan@janakj.org>
//
// Permission to use, copy, modify, and/or distribute this software for any
// purpose with or without fee is hereby granted, provided that the above
// copyright notice and this permission notice appear in all copies.
//
// THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
// WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
// MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
// ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
// WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
// ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
// OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

import { userInfo, hostname } from 'os';
import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import { createConnection, Socket } from 'net';

import { PulseError } from './error';
import { Props } from './props';
import { PlaybackStream, RecordStream, UploadStream } from './stream';
import { MemoryBlock, PA_TAG, PA_STREAM_DESCRIPTOR, PA_STREAM_DESCRIPTOR_SIZE } from './packet';
import { Command, PA_COMMAND } from './command';
import { SubscribeEvent, StreamEvent, PA_SUBSCRIPTION_MASK } from './event';
import { logger, PA_NATIVE_PROTOCOL_VERSION, PA_NO_VALUE, PA_NO_INDEX, PA_DEFAULT_SINK, PA_DEFAULT_SOURCE, PA_NO_TAG, cookieFile, defaultSockPath } from './defs';
import * as Cmd from './command';

const debug = logger.extend('client');


const machineId = async () => (await fs.readFile('/etc/machine-id', 'ascii')).trim();


function connect(sock: Socket) {
    return new Promise((resolve, reject) => {
        const onError = (error: Error) => {
            sock.off('connect', onConnect);
            reject(error);
        }

        const onConnect:(...args: any[]) => void = () => {
            sock.off('close', onError);
            sock.off('error', onError);
            resolve(sock);
        }

        sock.once('connect', onConnect);
        sock.once('error', onError);
        sock.once('close', onError);
    });
}


export async function getDefaultAppProps(appName?:string) {
    const { npm_package_name: appId, npm_package_version: appVersion } = process.env;

    const data: Props = {
        process : {
            id     : `${process.pid}`,
            binary : `${process.argv.join(' ')}`,
            user   : `${userInfo().username}`,
            host   : `${hostname()}`
        }
    }

    try {
        (data.process as Props).machine_id = await machineId();
    } catch(error) {
        if ((error as any).code !== 'ENOENT') throw error;
    }

    if (appName)    data.name    = appName;
    if (appId)      data.id      = appId;
    if (appVersion) data.version = appVersion;

    return data;
}


async function loadCookie() {
    debug(`Trying to load PulseAudio authentication cookie from '${cookieFile}'`);
    try {
        return await fs.readFile(cookieFile);
    } catch (error) {
        if ((error as any).code === 'ENOENT') {
            debug(`PulseAudio cookie file '${cookieFile}' not found`);
            return undefined;
        }
        throw error;
    }
}


export class PulseAudio extends EventEmitter {
    eventName = /^event(\.|$)/;

    streams: {
        playback : { [index: number]: PlaybackStream },
        record   : { [index: number]: RecordStream   },
        upload   : { [index: number]: UploadStream   }
    }
    getAppProps     : () => Promise<Props> | Props;
    eventListeners  : number;
    sockPath        : string;
    cookie          : Buffer | undefined;
    requests        : any;
    packetLength    : number | null;
    sock            : any;
    protocol        : number;
    _disconnecting? : {
        resolve : (value?: unknown) => void;
        reject  : (reason: Error) => void;
    }
    header          : Buffer | null;

    constructor(appProps?: string | Props | (() => Promise<Props> | Props), cookie?: Buffer, sockPath?: string) {
        super();
        this.streams = {
            playback : {},
            record   : {},
            upload   : {}
        }
        this.protocol = PA_NO_VALUE;
        this.header = null;
        this.packetLength = null;
        this.eventListeners = 0;
        this.sockPath = sockPath || defaultSockPath;
        this.cookie = cookie;

        if (typeof appProps === 'string' || typeof appProps === 'undefined') {
            // If appProps is a string, use that as the application's name. If
            // set to undefined, PulseAudio server will set a default name. In
            // both cases call getApplicationProps to build the default set of
            // application properties.
            this.getAppProps = () => getDefaultAppProps(appProps);
        } else if (typeof appProps === 'object') {
            // If appProps is an object, assume the caller provided a complete
            // set of application properties. Wrap those in a getter function to
            // be invoked from the connect method.
            this.getAppProps = () => appProps;
        } else {
            // If appProps is a function, store it as a callback to be invoked
            // from the connect method.
            this.getAppProps = appProps;
        }

        this._read = this._read.bind(this);
        this._closed = this._closed.bind(this);
        this.requests = Object.create(null);
        this._newListener = this._newListener.bind(this);
        this._removeListener = this._removeListener.bind(this);
        this.on('newListener', this._newListener);
        this.on('removeListener', this._removeListener);
    }

    _newListener(event: string) {
        if (!this.eventName.test(event)) return;

        if (++this.eventListeners === 1) {
            debug(`Subscribing to PulseAudio events`);
            this._subscribe(PA_SUBSCRIPTION_MASK.ALL);
        }
    }

    _removeListener(event: string) {
        if (!this.eventName.test(event)) return;

        if (--this.eventListeners === 0) {
            debug(`Unsubscribing from PulseAudio events`);
            this._subscribe(PA_SUBSCRIPTION_MASK.NULL);
        }
    }

    async connect(clientProps?: Props | (() => Promise<Props> | Props)) {
        debug(`Connecting to PulseAudio via '${this.sockPath}'`);
        this.packetLength = null;
        this.header = null;

        this.sock = createConnection(this.sockPath);
        this.sock.on('readable', this._read);
        this.sock.once('close', this._closed);
        this.sock.once('error', this._closed);

        await connect(this.sock);
        this.protocol = await this._authenticate(this.cookie || await loadCookie(), PA_NATIVE_PROTOCOL_VERSION);
        const server = await this.getServerInfo();
        debug(`Connected to ${server.name} ${server.version} speaking native protocol versions <= ${this.protocol}`);

        // This PulseAudio client currently does not support any older protocol
        // versions, so bail early if we are connected to an older PulseAudio
        // server.
        if (this.protocol < PA_NATIVE_PROTOCOL_VERSION)
            throw new Error(`The client requires native protocol >= ${PA_NATIVE_PROTOCOL_VERSION}`);

        let props: Props;

        if (typeof clientProps === 'undefined') {
            props = { application : await this.getAppProps() }
        } else if (typeof clientProps === 'object') {
            props = Object.assign(clientProps);
        } else {
            props = await clientProps();
        }

        await this.setClientProperties(props);
    }

    async disconnect() {
        if (this._disconnecting) return this._disconnecting;
        if (!this.sock) return undefined;

        this.sock.end();
        return new Promise((resolve, reject) => {
            this._disconnecting = { resolve, reject }
        })
    }

    _closed() {
        const error = new Error('Disconnected from PulseAudio');

        this._abort(error);
        this.sock.end();
        this.sock.off('readable', this._read);
        this.sock.off('close', this._closed);
        this.sock.off('error', this._closed);
        delete this.sock;

        if (this._disconnecting) {
            this._disconnecting.resolve();
            delete this._disconnecting;
        } else {
            // If we were not asked by the user to disconnect from PulseAudio, emit an
            // error event to bring down the application
            this.emit('error', error);
        }
    }

    _abort(error: Error) {
        for (const t of Object.values(this.streams))
            for (const s of Object.values(t))
                s.emit('error', error);

        for (const { reject } of Object.values<{ reject: (reason: Error) => void }>(this.requests)) reject(error);
        this.requests = Object.create(null);
    }

    _parse(header: Buffer, body: Buffer) {
        let msg, stream, arg;
        const channel = header.readUInt32BE(PA_STREAM_DESCRIPTOR.CHANNEL * 4);

        if (channel !== PA_NO_INDEX) {
            // Incoming memory block. Lookup the corresponding recording stream and
            // pass the memory block to it.
            stream = this.streams.record[channel];
            if (stream) stream._onData(new MemoryBlock(header, body));
            return;
        }

        if ((body.length < 5) || (body[0] !== PA_TAG.U32))
            throw new Error(`Got malformed packet from PulseAudio`);

        const type = body.readUInt32BE(1);

        switch (type) {
            case PA_COMMAND.REPLY:
            case PA_COMMAND.ERROR:
                // A response to a command issued by the client. Lookup the command and
                // fullfill its promise.
                msg = new Command(body, header);

                if (msg.tag === PA_NO_TAG)
                    throw new Error('Error/reply packet is missing tag');

                if (!(msg.tag in this.requests))
                    throw new Error('Received unknown tag from PulseAudio');

                if (msg.type === PA_COMMAND.REPLY)
                    this.requests[msg.tag].resolve(msg);
                else
                    this.requests[msg.tag].reject(new PulseError(msg));

                delete this.requests[msg.tag];
                break;

            case PA_COMMAND.SUBSCRIBE_EVENT:
                // An incoming event from PulseAudio server notifying the client of
                // changes to the objects managed by the server. Emit the corresponding
                // event on the PulseAudio object.
                msg = new SubscribeEvent(header, body);
                arg = {
                    index     : msg.index,
                    event     : msg.event,
                    facility  : msg.facility,
                    operation : msg.operation
                }
                // The handlers for the following events get all attributes from the event
                // via an object in the first argument
                this.emit('event', arg);
                this.emit(`event.${msg.facility}`, arg);
                this.emit(`event.${msg.operation}`, arg);

                // The handlers for the full event name get the index in the first argument
                // and the PulseAudio event number  in the second argument
                this.emit(`event.${msg.facility}.${msg.operation}`, msg.index, msg.event);
                debug(`event.${msg.facility}.${msg.operation}(${msg.index})`);
                break;

            case PA_COMMAND.PLAYBACK_STREAM_EVENT:
            case PA_COMMAND.PLAYBACK_STREAM_SUSPENDED:
            case PA_COMMAND.PLAYBACK_STREAM_MOVED:
            case PA_COMMAND.PLAYBACK_STREAM_KILLED:
            case PA_COMMAND.PLAYBACK_BUFFER_ATTR_CHANGED:
            case PA_COMMAND.STARTED:
            case PA_COMMAND.REQUEST:
            case PA_COMMAND.UNDERFLOW:
            case PA_COMMAND.OVERFLOW:
                msg = new StreamEvent(header, body);
                stream = this.streams.playback[msg.index];
                if (stream) stream._onEvent(msg);
                break;

            case PA_COMMAND.RECORD_STREAM_EVENT:
            case PA_COMMAND.RECORD_STREAM_SUSPENDED:
            case PA_COMMAND.RECORD_STREAM_MOVED:
            case PA_COMMAND.RECORD_STREAM_KILLED:
            case PA_COMMAND.RECORD_BUFFER_ATTR_CHANGED:
                msg = new StreamEvent(header, body);
                stream = this.streams.record[msg.index];
                if (stream) stream._onEvent(msg);
                break;

            default:
                throw new Error(`Unsupported packet type ${type}`);
        }
    }

    _read() {
        for (; ;) {
            try {
                if (this.packetLength === null) {
                    this.header = this.sock.read(PA_STREAM_DESCRIPTOR_SIZE);
                    if (this.header === null) return;
                    if (this.header.length !== PA_STREAM_DESCRIPTOR_SIZE)
                        throw new Error('Malformed packet received from PulseAudio');
                    this.packetLength = this.header.readUInt32BE();
                }

                const body = this.sock.read(this.packetLength);
                if (body === null) return;
                if (body.length !== this.packetLength)
                    throw new Error('Malformed packet received from PulseAudio');

                if (this.header === null)
                    throw new Error('Bug in PulseAudio client (header === null)');

                this._parse(this.header, body);
                this.packetLength = null;
                this.header = null;
            } catch (error) {
                this.emit('error', error);
                return;
            }
        }
    }

    async _invoke(cmd: Command) {
        return await new Promise<Command>((resolve, reject) => {
            this.requests[cmd.tag] = { resolve, reject }
            cmd.finalize().forEach(data => this.sock.write(data))
        });
    }

    // Internal methods

    async _authenticate(...args: ConstructorParameters<typeof Cmd.Auth>) {
        const c = new Cmd.Auth(...args);
        return c.processResponse(await this._invoke(c));
    }

    async _subscribe(...args: ConstructorParameters<typeof Cmd.Subscribe>) {
        await this._invoke(new Cmd.Subscribe(...args));
    }

    // Client-related methods

    async setClientProperties(...args: ConstructorParameters<typeof Cmd.SetClientName>) {
        const c = new Cmd.SetClientName(...args);
        return c.processResponse(await this._invoke(c));
    }

    // Server-related methods

    async getServerInfo(...args: ConstructorParameters<typeof Cmd.GetServerInfo>) {
        const c = new Cmd.GetServerInfo(...args);
        return c.processResponse(await this._invoke(c));
    }

    async loadModule(...args: ConstructorParameters<typeof Cmd.LoadModule>) {
        const c = new Cmd.LoadModule(...args);
        return c.processResponse(await this._invoke(c));
    }

    async unloadModule(index: number) {
        await this._invoke(new Cmd.SelectByIndex(PA_COMMAND.UNLOAD_MODULE, index));
    }

    async getAllSources() {
        const c = new Cmd.GetSourceSinkInfoList(PA_COMMAND.GET_SOURCE_INFO_LIST);
        return c.processResponse(await this._invoke(c));
    }

    async getAllSinks() {
        const c = new Cmd.GetSourceSinkInfoList(PA_COMMAND.GET_SINK_INFO_LIST);
        return c.processResponse(await this._invoke(c));
    }

    // Audio source (recording) management methods

    async setDefaultSource(name: string) {
        await this._invoke(new Cmd.SelectByName(PA_COMMAND.SET_DEFAULT_SOURCE, name));
    }

    async lookupSource(name: string = PA_DEFAULT_SOURCE) {
        const c = new Cmd.Lookup(PA_COMMAND.LOOKUP_SOURCE, name);
        return c.processResponse(await this._invoke(c));
    }

    async getSourceInfo(nameOrIndex: string | number = PA_DEFAULT_SOURCE) {
        const c = new Cmd.GetSourceSinkInfo(PA_COMMAND.GET_SOURCE_INFO, nameOrIndex);
        return c.processResponse(await this._invoke(c));
    }

    async setSourceVolume(volumes: number | number[], nameOrIndex: string | number = PA_DEFAULT_SOURCE) {
        await this._invoke(new Cmd.SetVolume(PA_COMMAND.SET_SOURCE_VOLUME, nameOrIndex, volumes));
    }

    async setSourceMute(mute: boolean, nameOrIndex: string | number=PA_DEFAULT_SOURCE) {
        await this._invoke(new Cmd.SetMute(PA_COMMAND.SET_SOURCE_MUTE, nameOrIndex, mute));
    }

    async setSourceOutputVolume(index: number, volumes: number | number[]) {
        await this._invoke(new Cmd.SetVolumeByIndex(PA_COMMAND.SET_SOURCE_OUTPUT_VOLUME, index, volumes));
    }

    async setSourceOutputMute(index: number, mute: boolean) {
        await this._invoke(new Cmd.SetMuteByIndex(PA_COMMAND.SET_SOURCE_OUTPUT_MUTE, index, mute));
    }

    async getSourceOutputInfo(...args: ConstructorParameters<typeof Cmd.GetSourceOutputInfo>) {
        const c = new Cmd.GetSourceOutputInfo(...args);
        return c.processResponse(await this._invoke(c));
    }

    async createRecordStream(...args: ConstructorParameters<typeof Cmd.CreateRecordStream>) {
        const c = new Cmd.CreateRecordStream(...args);
        return c.processResponse(await this._invoke(c), this);
    }

    // // Audio sink (playback) management methods

    async setDefaultSink(name: string) {
        await this._invoke(new Cmd.SelectByName(PA_COMMAND.SET_DEFAULT_SINK, name));
    }

    async lookupSink(name = PA_DEFAULT_SINK) {
        const c = new Cmd.Lookup(PA_COMMAND.LOOKUP_SINK, name);
        return c.processResponse(await this._invoke(c));
    }

    async getSinkInfo(nameOrIndex: string | number = PA_DEFAULT_SINK) {
        const c = new Cmd.GetSourceSinkInfo(PA_COMMAND.GET_SINK_INFO, nameOrIndex);
        return c.processResponse(await this._invoke(c));
    }

    async setSinkVolume(volumes: number | number[], nameOrIndex: string | number = PA_DEFAULT_SINK) {
        await this._invoke(new Cmd.SetVolume(PA_COMMAND.SET_SINK_VOLUME, nameOrIndex, volumes));
    }

    async setSinkMute(mute: boolean, nameOrIndex: string | number = PA_DEFAULT_SINK) {
        await this._invoke(new Cmd.SetMute(PA_COMMAND.SET_SINK_MUTE, nameOrIndex, mute));
    }

    async setSinkInputVolume(index: number, volumes: number | number[]) {
        await this._invoke(new Cmd.SetVolumeByIndex(PA_COMMAND.SET_SINK_INPUT_VOLUME, index, volumes));
    }

    async setSinkInputMute(index: number, mute: boolean) {
        await this._invoke(new Cmd.SetMuteByIndex(PA_COMMAND.SET_SINK_INPUT_MUTE, index, mute));
    }

    async getSinkInputInfo(...args: ConstructorParameters<typeof Cmd.GetSinkInputInfo>) {
        const c = new Cmd.GetSinkInputInfo(...args);
        return c.processResponse(await this._invoke(c));
    }

    async getSinkInputList() {
        const c = new Cmd.GetSinkInputList(PA_COMMAND.GET_SINK_INPUT_INFO_LIST)
        return c.processResponse(await this._invoke(c))
    }

    async moveSinkInput(index: number, sink: number | string) {
        await this._invoke(new Cmd.MoveSinkInput(index, sink));
    }

    async createPlaybackStream(opts: any = {}) {
        const c = new Cmd.CreatePlaybackStream(opts);
        return c.processResponse(await this._invoke(c), this);
    }

    // // Sample cache management

    async createUploadStream(...args: ConstructorParameters<typeof Cmd.CreateUploadStream>) {
        const c = new Cmd.CreateUploadStream(...args);
        return c.processResponse(await this._invoke(c), this);
    }

    async playSample(...args: ConstructorParameters<typeof Cmd.PlaySample>) {
        const c = new Cmd.PlaySample(...args);
        return c.processResponse(await this._invoke(c));
    }

    async removeSample(name: string) {
        await this._invoke(new Cmd.SelectByName(PA_COMMAND.REMOVE_SAMPLE, name));
    }

    // PulseAudio clients

    async getClients() {
        const c = new Cmd.GetClientsList(PA_COMMAND.GET_CLIENT_INFO_LIST);
        return c.processResponse(await this._invoke(c));
    }
}
