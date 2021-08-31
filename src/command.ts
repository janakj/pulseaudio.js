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

import { logger, PA_NO_VALUE, PA_NATIVE_PROTOCOL_VERSION, PA_NO_INDEX, PA_MAX_CHANNELS, PA_DEFAULT_SINK, PA_NATIVE_COOKIE_LENGTH } from './defs';
import { TagStruct, SampleSpec } from './packet';
import { Props, deflate } from './props';
import { RecordStream, UploadStream, PlaybackStream } from './stream';
import { PA_VOLUME_NORM } from './volume';
import { wavToChannelMap } from './wav';
import type { PulseAudio } from './client';

const debug = logger.extend('cmd');


const PA_MIN_INDEX  = 0;
const PA_NO_CHANNEL = PA_NO_VALUE;
const PA_MAX_INDEX  = 0xfffffffe;


// A global syncId counter that is used to generate a unique syncId to each
// newly created playback stream unless the client overrides the value.
let syncIdCounter = 0;


let requestTag = 0xfffffffe;
function getRequestTag() {
    requestTag = (requestTag + 1) % 0xfffffffe;
    return requestTag;
}


// Must match pulsecore/native-common.h

export enum PA_COMMAND {
    /* Generic commands */
    ERROR,
    TIMEOUT, /* pseudo command */
    REPLY,

    /* CLIENT->SERVER */
    CREATE_PLAYBACK_STREAM, /* Payload changed in v9, v12 (0.9.0, 0.9.8) */
    DELETE_PLAYBACK_STREAM,
    CREATE_RECORD_STREAM,   /* Payload changed in v9, v12 (0.9.0, 0.9.8) */
    DELETE_RECORD_STREAM,
    EXIT,
    AUTH,
    SET_CLIENT_NAME,
    LOOKUP_SINK,
    LOOKUP_SOURCE,
    DRAIN_PLAYBACK_STREAM,
    STAT,
    GET_PLAYBACK_LATENCY,
    CREATE_UPLOAD_STREAM,
    DELETE_UPLOAD_STREAM,
    FINISH_UPLOAD_STREAM,
    PLAY_SAMPLE,
    REMOVE_SAMPLE,

    GET_SERVER_INFO,
    GET_SINK_INFO,
    GET_SINK_INFO_LIST,
    GET_SOURCE_INFO,
    GET_SOURCE_INFO_LIST,
    GET_MODULE_INFO,
    GET_MODULE_INFO_LIST,
    GET_CLIENT_INFO,
    GET_CLIENT_INFO_LIST,
    GET_SINK_INPUT_INFO,      /* Payload changed in v11 (0.9.7) */
    GET_SINK_INPUT_INFO_LIST, /* Payload changed in v11 (0.9.7) */
    GET_SOURCE_OUTPUT_INFO,
    GET_SOURCE_OUTPUT_INFO_LIST,
    GET_SAMPLE_INFO,
    GET_SAMPLE_INFO_LIST,
    SUBSCRIBE,

    SET_SINK_VOLUME,
    SET_SINK_INPUT_VOLUME,
    SET_SOURCE_VOLUME,

    SET_SINK_MUTE,
    SET_SOURCE_MUTE,

    CORK_PLAYBACK_STREAM,
    FLUSH_PLAYBACK_STREAM,
    TRIGGER_PLAYBACK_STREAM,

    SET_DEFAULT_SINK,
    SET_DEFAULT_SOURCE,

    SET_PLAYBACK_STREAM_NAME,
    SET_RECORD_STREAM_NAME,

    KILL_CLIENT,
    KILL_SINK_INPUT,
    KILL_SOURCE_OUTPUT,

    LOAD_MODULE,
    UNLOAD_MODULE,

    /* Obsolete */
    ADD_AUTOLOAD___OBSOLETE,
    REMOVE_AUTOLOAD___OBSOLETE,
    GET_AUTOLOAD_INFO___OBSOLETE,
    GET_AUTOLOAD_INFO_LIST___OBSOLETE,

    GET_RECORD_LATENCY,
    CORK_RECORD_STREAM,
    FLUSH_RECORD_STREAM,
    PREBUF_PLAYBACK_STREAM,

    /* SERVER->CLIENT */
    REQUEST,
    OVERFLOW,
    UNDERFLOW,
    PLAYBACK_STREAM_KILLED,
    RECORD_STREAM_KILLED,
    SUBSCRIBE_EVENT,

    /* A few more client->server commands */

    /* Supported since protocol v10 (0.9.5) */
    MOVE_SINK_INPUT,
    MOVE_SOURCE_OUTPUT,

    /* Supported since protocol v11 (0.9.7) */
    SET_SINK_INPUT_MUTE,
    SUSPEND_SINK,
    SUSPEND_SOURCE,

    /* Supported since protocol v12 (0.9.8) */
    SET_PLAYBACK_STREAM_BUFFER_ATTR,
    SET_RECORD_STREAM_BUFFER_ATTR,
    UPDATE_PLAYBACK_STREAM_SAMPLE_RATE,
    UPDATE_RECORD_STREAM_SAMPLE_RATE,

    /* SERVER->CLIENT */
    PLAYBACK_STREAM_SUSPENDED,
    RECORD_STREAM_SUSPENDED,
    PLAYBACK_STREAM_MOVED,
    RECORD_STREAM_MOVED,

    /* Supported since protocol v13 (0.9.11) */
    UPDATE_RECORD_STREAM_PROPLIST,
    UPDATE_PLAYBACK_STREAM_PROPLIST,
    UPDATE_CLIENT_PROPLIST,
    REMOVE_RECORD_STREAM_PROPLIST,
    REMOVE_PLAYBACK_STREAM_PROPLIST,
    REMOVE_CLIENT_PROPLIST,

    /* SERVER->CLIENT */
    STARTED,

    /* Supported since protocol v14 (0.9.12) */
    EXTENSION,

    /* Supported since protocol v15 (0.9.15) */
    GET_CARD_INFO,
    GET_CARD_INFO_LIST,
    SET_CARD_PROFILE,

    CLIENT_EVENT,
    PLAYBACK_STREAM_EVENT,
    RECORD_STREAM_EVENT,

    /* SERVER->CLIENT */
    PLAYBACK_BUFFER_ATTR_CHANGED,
    RECORD_BUFFER_ATTR_CHANGED,

    /* Supported since protocol v16 (0.9.16) */
    SET_SINK_PORT,
    SET_SOURCE_PORT,

    /* Supported since protocol v22 (1.0) */
    SET_SOURCE_OUTPUT_VOLUME,
    SET_SOURCE_OUTPUT_MUTE,

    /* Supported since protocol v27 (3.0) */
    SET_PORT_LATENCY_OFFSET,

    /* Supported since protocol v30 (6.0) */
    /* BOTH DIRECTIONS */
    ENABLE_SRBCHANNEL,
    DISABLE_SRBCHANNEL,

    /* Supported since protocol v31 (9.0)
     * BOTH DIRECTIONS */
    REGISTER_MEMFD_SHMID,

    MAX
}


export class Command extends TagStruct {
    type : any;
    tag  : number;

    constructor(cmdOrBody: Buffer | number, header? : Buffer | null) {
        if (Buffer.isBuffer(cmdOrBody)) {
            super(header, cmdOrBody);
            this.type = this.getUInt32();
            this.tag = this.getUInt32();
        } else if (typeof cmdOrBody === 'number') {
            super(header);
            this.setChannel(PA_NO_CHANNEL); // Command packets must have the descriptor channel field set to 0xffffffff
            this.type = cmdOrBody;
            this.addUInt32(cmdOrBody);
            this.tag = getRequestTag();
            this.addUInt32(this.tag);
        } else {
            throw new Error(`First argument to Command must be a Buffer or number`);
        }
    }
}


export class Auth extends Command {
    static PA_PROTOCOL_VERSION_MASK = 0xffff;

    constructor(cookie?: Buffer, proto?: number) {
        super(PA_COMMAND.AUTH);

        // When connecting over a UNIX domain socket, the server checks the uid and
        // git of the remote process and if it matches the uid and git of the
        // PulseAudio daemon, it does not check the cookie. However, even in that
        // case the daemon expects that the client sends some cookie. If no cookie
        // was provided by the user, create an empty one here.
        if (!cookie) {
            debug(`No authentication cookie provided, proceeding with uid/gid authentication`);
            cookie = Buffer.alloc(PA_NATIVE_COOKIE_LENGTH);
        }

        if (cookie.length !== PA_NATIVE_COOKIE_LENGTH)
            throw new Error('Invalid cookie');

        this.addUInt32(proto || PA_NATIVE_PROTOCOL_VERSION);
        this.addArbitrary(cookie);
    }

    processResponse(packet: TagStruct) {
        const v = packet.getUInt32();
        // In recent Pulseaudio protocol version the most significant bytes are
        // reserved for flags related to shared memory support.
        return v & Auth.PA_PROTOCOL_VERSION_MASK;
    }
}


export class SetClientName extends Command {
    constructor(nameOrProps: string | Props) {
        super(PA_COMMAND.SET_CLIENT_NAME);

        let props: Props;

        if (typeof nameOrProps === 'string') props = { application: { name: nameOrProps } }
        else props = Object.assign(nameOrProps);
        this.addProps(props);
    }

    processResponse(packet: TagStruct) {
        return packet.getUInt32();
    }
}


export interface ServerInfo {
    name              : string;
    version           : string;
    username          : string;
    hostname          : string;
    sampleSpec        : SampleSpec;
    defaultSink       : string;
    defaultSource     : string;
    cookie            : number;
    defaultChannelMap : number[];
}


export class GetServerInfo extends Command {
    constructor() {
        super(PA_COMMAND.GET_SERVER_INFO);
    }

    processResponse(packet: TagStruct) : ServerInfo {
        return {
            name              : packet.getString() ?? '',
            version           : packet.getString() ?? '',
            username          : packet.getString() ?? '',
            hostname          : packet.getString() ?? '',
            sampleSpec        : packet.getSampleSpec(),
            defaultSink       : packet.getString() ?? '',
            defaultSource     : packet.getString() ?? '',
            cookie            : packet.getUInt32(),
            defaultChannelMap : packet.getChannelMap() // if procol version >= 15
        }
    }
}


export class SelectByIndex extends Command {
    constructor(cmd: PA_COMMAND, index: number) {
        if (typeof index !== 'number')
            throw new Error('Index value must be a number');

        if ((index < PA_MIN_INDEX || index > PA_MAX_INDEX) && index !== PA_NO_INDEX)
            throw new Error('Index value out of range');

        super(cmd);

        this.addUInt32(index);
    }
}


export class SelectByName extends Command {
    constructor(cmd: PA_COMMAND, name: string | null) {
        super(cmd);

        if (name !== null && typeof name !== 'string')
            throw new Error(`Name must be a string or null`);
        this.addString(name);
    }
}


export class SelectByNameOrIndex extends SelectByIndex {
    constructor(cmd: PA_COMMAND, nameOrIndex: number | string | null) {
        if (typeof nameOrIndex === 'number') {
            super(cmd, nameOrIndex);
            this.addString(null);
        } else if (typeof nameOrIndex === 'string' || nameOrIndex === null) {
            super(cmd, PA_NO_INDEX);
            this.addString(nameOrIndex);
        } else {
            throw new Error('Sink/source name must be a number, string, or null');
        }
    }
}


export class SetVolume extends SelectByNameOrIndex {
    constructor(cmd: PA_COMMAND, nameOrIndex: number | string | null, volumes: number | number[]) {
        super(cmd, nameOrIndex);

        if (!Array.isArray(volumes)) volumes = [volumes];
        if (volumes.length < 1 || volumes.length > PA_MAX_CHANNELS)
            throw new Error(`Expected between 1 and ${PA_MAX_CHANNELS} volume levels`);

        this.addCvolume(volumes);
    }
}


export class SetVolumeByIndex extends SelectByIndex {
    constructor(cmd: PA_COMMAND, index: number, volumes: number | number[]) {
        super(cmd, index);

        if (!Array.isArray(volumes)) volumes = [volumes];
        if (volumes.length < 1 || volumes.length > PA_MAX_CHANNELS)
            throw new Error(`Expected between 1 and ${PA_MAX_CHANNELS} volume levels`);

        this.addCvolume(volumes);
    }
}


export class SetMute extends SelectByNameOrIndex {
    constructor(cmd: PA_COMMAND, nameOrIndex: number | string | null, mute: boolean) {
        super(cmd, nameOrIndex);

        if (typeof mute !== 'boolean')
            throw new Error('Mute value must be a boolean');

        this.addBool(mute);
    }
}


export class SetMuteByIndex extends SelectByIndex {
    constructor(cmd: PA_COMMAND, index: number, mute: boolean) {
        super(cmd, index);

        if (typeof mute !== 'boolean')
            throw new Error('Value must be a boolean');

        this.addBool(mute);
    }
}


export class Lookup extends SelectByName {
    processResponse(packet: TagStruct) {
        return packet.getUInt32();
    }
}


function parseSourceSink(packet: TagStruct) {
    const rv: any = {
        index       : packet.getUInt32(),
        name        : packet.getString(),
        description : packet.getString(),
        sampleSpec  : packet.getSampleSpec(),
        channelMap  : packet.getChannelMap(),
        module      : packet.getUInt32(),
        volume      : {
            current : packet.getCvolume(),
        },
        mute    : packet.getBool(),
        monitor : {
            index : packet.getUInt32(),
            name  : packet.getString(),
        },
        latency: {
            current: packet.getUsec()
        },
        driver : packet.getString(),
        flags  : packet.getUInt32()
    }

    // client version >= 13
    rv.properties        = packet.getProps();
    rv.latency.requested = packet.getUsec();

    // client version >= 15
    rv.volume.base  = packet.getVolume();
    rv.state        = packet.getUInt32();
    rv.volume.steps = packet.getUInt32();
    rv.card         = packet.getUInt32();

    // client version >= 16
    rv.ports = [];
    const ports = packet.getUInt32();
    for (let i = 0; i < ports; i++) {
        rv.ports.push({
            name        : packet.getString(),
            description : packet.getString(),
            priority    : packet.getUInt32(),
            available   : packet.getUInt32()  // client version >= 24
        });
    }
    rv.activePort = packet.getString();

    // client version >= 21
    rv.formats = [];
    const formats = packet.getUInt8();
    for (let i = 0; i < formats; i++)
        rv.formats.push(packet.getFormatInfo());

    return rv;
}


export class GetSourceSinkInfo extends SelectByNameOrIndex {
    processResponse(packet: TagStruct) {
        return parseSourceSink(packet);
    }
}


export class GetSourceSinkInfoList extends Command {
    processResponse(packet: TagStruct) {
        const rv: Record<string, unknown>[] = [];
        while (packet.i < packet.body.length)
            rv.push(parseSourceSink(packet));
        return rv;
    }
}


export class LoadModule extends SelectByName {
    static argsToString(args: Record<string, unknown>) {
        let rv = '';
        for (const [key, val] of Object.entries(args)) {
            if (rv.length) rv += ' ';

            rv += `${key}=`;

            switch (typeof val) {
                case 'string':
                    rv += `'${val.replace(/([^\\])'/g, "$1\\'")}'`;
                    break;

                case 'object':
                    rv += `"${LoadModule.argsToString(deflate((val || {}) as Props)).replace(/([^\\])"/g, '$1\\"')}"`;
                    break;

                case 'number':
                case 'boolean':
                    rv += `${val}`;
                    break;

                default:
                    throw new Error(`Unsupported value type for argument ${key}`);
            }
        }
        return rv;
    }

    constructor(name: string, args?: Record<string, unknown>) {
        super(PA_COMMAND.LOAD_MODULE, name);
        this.addString(LoadModule.argsToString(args || {}));
    }

    processResponse(packet: TagStruct) {
        return packet.getUInt32();
    }
}


export class PlaySample extends SelectByNameOrIndex {
    static defaults = {
        volume     : PA_VOLUME_NORM,
        sink       : PA_DEFAULT_SINK,
        properties : {}
    }

    constructor(name: string, opts: any = {}) {
        opts = { ...PlaySample.defaults, ...opts }

        if (typeof name !== 'string' || !name.length)
            throw new Error('Sample name must be a non-empty string');

        if (typeof opts.volume !== 'number')
            throw new Error('Sample volume must be a number');

        super(PA_COMMAND.PLAY_SAMPLE, opts.sink);

        this.addUInt32(opts.volume);
        this.addString(name);
        this.addProps(opts.properties);
    }

    processResponse(packet: TagStruct) {
        return packet.getUInt32();
    }
}


export class Subscribe extends Command {
    constructor(mask: number) {
        super(PA_COMMAND.SUBSCRIBE);
        this.addUInt32(mask);
    }
}


export class GetSinkInputInfo extends SelectByIndex {
    constructor(index: number) {
        super(PA_COMMAND.GET_SINK_INPUT_INFO, index);
    }

    processResponse(packet: TagStruct) {
        return {
            index      : packet.getUInt32(),
            name       : packet.getString(),
            module     : packet.getUInt32(),
            client     : packet.getUInt32(),
            sink       : packet.getUInt32(),
            sampleSpec : packet.getSampleSpec(),
            channelMap : packet.getChannelMap(),
            volume     : packet.getCvolume(),
            latency    : {
                minimum : packet.getUsec(),
                maximum : packet.getUsec()
            },
            resampleMethod : packet.getString(),
            driver         : packet.getString(),
            muted          : packet.getBool(),
            properties     : packet.getProps(),
            corked         : packet.getBool(),
            hasVolume      : packet.getBool(),
            writableVolume : packet.getBool(),
            formatInfo     : packet.getFormatInfo()
        }
    }
}


type StreamType = "upload" | "playback" | "record";

class CreateStream extends Command {
    static cmdToType(cmd: PA_COMMAND): StreamType {
        switch (cmd) {
            case PA_COMMAND.CREATE_UPLOAD_STREAM   : return 'upload';
            case PA_COMMAND.CREATE_PLAYBACK_STREAM : return 'playback';
            case PA_COMMAND.CREATE_RECORD_STREAM   : return 'record';
            default: throw new Error(`Unsupported command ${cmd}`);
        }
    }

    constructor(cmd: PA_COMMAND) {
        super(cmd);
        this.type = CreateStream.cmdToType(cmd);
    }

    static parseOpts(opts: any, defaults={}) {
        const o = { ...defaults, ...opts }

        if (o.sampleSpec === null)
            throw new Error(`Property 'sampleSpec' must be provided`);

        // If the caller did not provide a channel map, create a default one based
        // on the number of channels specified in sampleSpec
        if (o.channelMap === null)
            o.channelMap = wavToChannelMap(o.sampleSpec.channels);

        // If the volume property was not provided, configure all channels with
        // maximum volume
        if (o.volume === null)
            o.volume = Array(o.sampleSpec.channels).fill(PA_VOLUME_NORM);

        return o;
    }

    _addFormats(formats: [any]) {
        this.addUInt8(formats.length);
        for (let fmt of formats) {
            if (!Array.isArray(fmt)) fmt = [fmt];
            this.addFormatInfo(fmt[0], fmt[1]);
        }
    }
}


export class CreatePlaybackStream extends CreateStream {
    opts: any;
    static defaults = {
        sampleSpec             : null,    // No defaults, sampleSpec must be provided
        channelMap             : null,    // Will be created based on sampleSpec.channels if omitted
        index                  : PA_NO_INDEX,
        name                   : null,
        maximumLength          : PA_NO_VALUE,
        corked                 : false,
        properties             : {},
        targetLength           : PA_NO_VALUE,
        preBuffering           : PA_NO_VALUE,
        minimumRequest         : PA_NO_VALUE,
        volume                 : null,        // Generate from sampleSpech.channels if null
        noRemap                : false,
        noRemix                : false,
        fixFormat              : false,
        fixRate                : false,
        fixChannels            : false,
        noMove                 : false,
        variableRate           : false,
        muted                  : false,
        adjustLatency          : false,
        volumeSet              : true,
        earlyRequests          : false,
        mutedSet               : false,
        dontInhibitAutoSuspend : false,
        failOnSuspend          : false,
        relativeVolume         : false,
        passthrough            : false,
        formats                : []
    }

    constructor(opts: any={}, cmd=PA_COMMAND.CREATE_PLAYBACK_STREAM) {
        super(cmd);
        opts = CreateStream.parseOpts(opts, CreatePlaybackStream.defaults);
        this.opts = opts;

        this.addSampleSpec(opts.sampleSpec);
        this.addChannelMap(opts.channelMap);
        this.addUInt32(opts.index);
        this.addString(opts.name);
        this.addUInt32(opts.maximumLength);
        this.addBool(opts.corked);
        this.addUInt32(opts.targetLength);
        this.addUInt32(opts.preBuffering);
        this.addUInt32(opts.minimumRequest);
        this.addUInt32(typeof opts.syncId === 'undefined' ? syncIdCounter : opts.syncId);
        this.addCvolume(opts.volume);
        this.addBool(opts.noRemap);
        this.addBool(opts.noRemix);
        this.addBool(opts.fixFormat);
        this.addBool(opts.fixRate);
        this.addBool(opts.fixChannels);
        this.addBool(opts.noMove);
        this.addBool(opts.variableRate);
        this.addBool(opts.muted);
        this.addBool(opts.adjustLatency);
        this.addProps(opts.properties);
        this.addBool(opts.volumeSet);
        this.addBool(opts.earlyRequests);
        this.addBool(opts.mutedSet);
        this.addBool(opts.dontInhibitAutoSuspend);
        this.addBool(opts.failOnSuspend);
        this.addBool(opts.relativeVolume);
        this.addBool(opts.passthrough);
        this._addFormats(opts.formats);

        // Every time we create a new playback stream, increment the globally unique
        // syncId counter so that its value is unique when the next stream is
        // created. This minimizes the probability that two streams that are not
        // meant to be synchronized will get the same syncId
        syncIdCounter++;
    }

    processResponse(packet: TagStruct, pulseaudio: PulseAudio) {
        const s = new PlaybackStream(pulseaudio, {
            index          : packet.getUInt32(),
            sinkInput      : packet.getUInt32(),
            requestedBytes : packet.getUInt32(),
            maximumLength  : this.opts.maximumLength,
            buffer         : {
                maximumLength  : packet.getUInt32(),
                targetLength   : packet.getUInt32(),
                preBuffering   : packet.getUInt32(),
                minimumRequest : packet.getUInt32()
            },
            sampleSpec : packet.getSampleSpec(),
            channelMap : packet.getChannelMap(),
            sink       : {
                index     : packet.getUInt32(),
                name      : packet.getString(),
                suspended : packet.getBool()
            },
            configuredSinkLatency : packet.getUsec(),
            format                : packet.getFormatInfo()
        });

        pulseaudio.streams.playback[s.index] = s;
        s.once('close', () => {
            delete pulseaudio.streams.playback[s.index];
        });

        return s;
    }
}


export class CreateUploadStream extends CreateStream {
    opts: any;
    static defaults = {
        name          : null,  // No defaults, name must be explicitly provided
        sampleSpec    : null,  // No defaults, sampleSpec must be provided
        channelMap    : null,  // Will be created based on sampleSpec.channels if omitted
        maximumLength : null,
        properties    : {}
    }

    constructor(opts: any = {}) {
        super(PA_COMMAND.CREATE_UPLOAD_STREAM);
        opts = CreateStream.parseOpts(opts, CreateUploadStream.defaults);
        if (opts.name === null)
            throw new Error(`Please provide a name for upload stream`);

        // For upload streams, we must provide the size of the wav file to the
        // PulseAudio server. It uses the value to allocate a memory buffer for the
        // sample.
        if (opts.maximumLength === null)
            throw new Error(`Please provide a value for attribute maximumLength`);

        this.opts = opts;

        this.addString(opts.name);
        this.addSampleSpec(opts.sampleSpec);
        this.addChannelMap(opts.channelMap);
        this.addUInt32(opts.maximumLength);
        this.addProps(opts.properties);
    }

    processResponse(packet: TagStruct, pulseaudio: PulseAudio) {
        const s = new UploadStream(pulseaudio, {
            index          : packet.getUInt32(),
            requestedBytes : packet.getUInt32(),
            maximumLength  : this.opts.maximumLength,
            sampleSpec     : this.opts.sampleSpec
        });

        pulseaudio.streams.upload[s.index] = s;
        s.once('close', () => {
            delete pulseaudio.streams.upload[s.index];
        });

        return s;
    }
}


export class CreateRecordStream extends CreateStream {
    opts: any;
    static defaults = {
        sampleSpec             : null,     // No defaults, sampleSpec must be provided
        channelMap             : null,     // Will be created based on sampleSpec.channels if omitted
        index                  : PA_NO_INDEX,
        name                   : null,
        maximumLength          : PA_NO_VALUE,
        corked                 : false,
        fragmentSize           : PA_NO_VALUE,
        noRemap                : false,
        noRemix                : false,
        fixFormat              : false,
        fixRate                : false,
        fixChannels            : false,
        noMove                 : false,
        variableRate           : false,
        peakDetect             : false,
        adjustLatency          : false,
        properties             : {},
        directOnInputIndex     : PA_NO_VALUE,
        earlyRequests          : false,
        dontInhibitAutoSuspend : false,
        failOnSuspend          : false,
        formats                : [],
        volume                 : null,
        muted                  : false,
        volumeSet              : false,
        mutedSet               : false,
        relativeVolume         : false,
        passthrough            : false
    }

    constructor(opts: any = {}) {
        super(PA_COMMAND.CREATE_RECORD_STREAM);
        opts = CreateStream.parseOpts(opts, CreateRecordStream.defaults);
        this.opts = opts;

        this.addSampleSpec(opts.sampleSpec);
        this.addChannelMap(opts.channelMap);
        this.addUInt32(opts.index);
        this.addString(opts.name);
        this.addUInt32(opts.maximumLength);
        this.addBool(opts.corked);
        this.addUInt32(opts.fragmentSize);
        this.addBool(opts.noRemap);
        this.addBool(opts.noRemix);
        this.addBool(opts.fixFormat);
        this.addBool(opts.fixRate);
        this.addBool(opts.fixChannels);
        this.addBool(opts.noMove);
        this.addBool(opts.variableRate);
        this.addBool(opts.peakDetect);
        this.addBool(opts.adjustLatency);
        this.addProps(opts.properties);
        this.addUInt32(opts.directOnInputIndex);
        this.addBool(opts.earlyRequests);
        this.addBool(opts.dontInhibitAutoSuspend);
        this.addBool(opts.failOnSuspend);
        this._addFormats(opts.formats);
        this.addCvolume(opts.volume);
        this.addBool(opts.muted);
        this.addBool(opts.volumeSet);
        this.addBool(opts.mutedSet);
        this.addBool(opts.relativeVolume);
        this.addBool(opts.passthrough);
    }

    processResponse(packet: TagStruct, pulseaudio: PulseAudio) {
        const s = new RecordStream(pulseaudio, {
            index         : packet.getUInt32(),
            sourceOutput  : packet.getUInt32(),
            maximumLength : this.opts.maximumLength,
            buffer        : {
                maximumLength : packet.getUInt32(),
                fragmentSize  : packet.getUInt32()
            },
            sampleSpec : packet.getSampleSpec(),
            channelMap : packet.getChannelMap(),
            source : {
                index     : packet.getUInt32(),
                name      : packet.getString(),
                suspended : packet.getBool()
            },
            configuredSourceLatency : packet.getUsec(),
            format                  : packet.getFormatInfo()
        });

        pulseaudio.streams.record[s.index] = s;
        s.once('close', () => {
            delete pulseaudio.streams.record[s.index];
        })

        return s;
    }
}


export class GetClientsList extends Command {
    processResponse(packet: TagStruct) {
        const rv: Record<string, unknown>[] = [];
        while (packet.i < packet.body.length) {
            rv.push({
                index       : packet.getUInt32(),
                name        : packet.getString(),
                ownerModule : packet.getUInt32(),
                driver      : packet.getString(),
                properties  : packet.getProps()
            })
        }
        return rv;
    }
}
