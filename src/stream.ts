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

import { Writable, Readable } from 'stream';

import { PA_ERR } from './error';
import { MemoryBlock } from './packet';
import { logger, PA_NO_VALUE, PA_NO_INDEX, PA_SAMPLE_FORMAT } from './defs';
import { PA_COMMAND, SelectByIndex } from './command';
import type { PulseAudio } from './client';
import { StreamEvent } from './event';


export const sampleSize = {
    [PA_SAMPLE_FORMAT.U8]        : 1,
    [PA_SAMPLE_FORMAT.ULAW]      : 1,
    [PA_SAMPLE_FORMAT.ALAW]      : 1,
    [PA_SAMPLE_FORMAT.S16LE]     : 2,
    [PA_SAMPLE_FORMAT.S16BE]     : 2,
    [PA_SAMPLE_FORMAT.FLOAT32LE] : 4,
    [PA_SAMPLE_FORMAT.FLOAT32BE] : 4,
    [PA_SAMPLE_FORMAT.S32LE]     : 4,
    [PA_SAMPLE_FORMAT.S32BE]     : 4,
    [PA_SAMPLE_FORMAT.S24LE]     : 3,
    [PA_SAMPLE_FORMAT.S24BE]     : 3,
    [PA_SAMPLE_FORMAT.S24_32LE]  : 4,
    [PA_SAMPLE_FORMAT.S24_32BE]  : 4
}


// eslint-disable-next-line @typescript-eslint/no-unused-vars
const sampleFormat = {
    [PA_SAMPLE_FORMAT.U8]        : 'u8',
    [PA_SAMPLE_FORMAT.ULAW]      : 'u-law',
    [PA_SAMPLE_FORMAT.ALAW]      : 'A-law',
    [PA_SAMPLE_FORMAT.S16LE]     : 'S16LE',
    [PA_SAMPLE_FORMAT.S16BE]     : 'S16BE',
    [PA_SAMPLE_FORMAT.FLOAT32LE] : 'Float32LE',
    [PA_SAMPLE_FORMAT.FLOAT32BE] : 'Float32BE',
    [PA_SAMPLE_FORMAT.S32LE]     : 'S32LE',
    [PA_SAMPLE_FORMAT.S32BE]     : 'S32BE',
    [PA_SAMPLE_FORMAT.S24LE]     : 'S24LE',
    [PA_SAMPLE_FORMAT.S24BE]     : 'S24BE',
    [PA_SAMPLE_FORMAT.S24_32LE]  : 'S24_32LE',
    [PA_SAMPLE_FORMAT.S24_32BE]  : 'S24_32BE'
}


export const sampleFormatStr = {
    'u8'        : PA_SAMPLE_FORMAT.U8,
    'u-law'     : PA_SAMPLE_FORMAT.ULAW,
    'A-law'     : PA_SAMPLE_FORMAT.ALAW,
    'S16LE'     : PA_SAMPLE_FORMAT.S16LE,
    'S16BE'     : PA_SAMPLE_FORMAT.S16BE,
    'Float32LE' : PA_SAMPLE_FORMAT.FLOAT32LE,
    'Float32BE' : PA_SAMPLE_FORMAT.FLOAT32BE,
    'S32LE'     : PA_SAMPLE_FORMAT.S32LE,
    'S32BE'     : PA_SAMPLE_FORMAT.S32BE,
    'S24LE'     : PA_SAMPLE_FORMAT.S24LE,
    'S24BE'     : PA_SAMPLE_FORMAT.S24BE,
    'S24_32LE'  : PA_SAMPLE_FORMAT.S24_32LE,
    'S24_32BE'  : PA_SAMPLE_FORMAT.S24_32BE
}


export function frameSize({ format, channels }: { format: PA_SAMPLE_FORMAT, channels: number }) {
    return sampleSize[format] * channels;
}


export class PlaybackStream extends Writable {
    pa              : PulseAudio;
    dbg             : debug.Debugger;
    index           : number;
    queue           : Buffer[];
    step            : number;
    left            : number;
    requestedBytes  : number;
    callback?       : () => void;

    constructor(pulseaudio: PulseAudio, args: any) {
        // Must set emitClose since the PulseAudio object listens for it
        super({ highWaterMark: 48000 * 2 * 2, decodeStrings: false, emitClose: true, autoDestroy: true });
        this.pa = pulseaudio;
        //this.index = PA_NO_INDEX
        this.requestedBytes = 0;
        this.index = PA_NO_INDEX;

        Object.assign(this, args);

        if (this.index === PA_NO_INDEX)
            throw new Error('PlaybackStream constructor must be given an index property');

        this.dbg = logger.extend(`playback:${this.index}`);
        this.queue = [];

        // We need to make sure that the data we send to PulseAudio server is
        // aligned at frame boundary.
        this.step = frameSize(args.sampleSpec);

        // The maximum number of bytes that can be played, obtained from the
        // request's maximumLength property. Set to null if there is no limit.
        this.left = args.maximumLength;
    }

    _onEvent(event: StreamEvent) {
        if (event.type === 'request') {
            if (typeof event.requestedBytes !== 'number')
                throw new Error('Bug: Missing StreamEvent attribute requestedBytes');
            this.requestedBytes += event.requestedBytes;

            this._wakeup();
            return;
        }

        this.dbg(`${event.type}`);
        this.emit(event.type as string, event);
        if (event.type === 'event')
            this.emit(`${event.type}.${event.event}`, event);

        // Destroy the stream if the corresponding object gets killed on PulseAudio
        // server
        if (event.type === 'killed')
            this.destroy(new Error(`Stream killed on PulseAudio server`));
    }

    _enqueued = () => this.queue.reduce((a, v) => a + v.length, 0);

    _wakeup() {
        // Calculate how much data we can really send. We cannot send more than
        // this.requestedBytes and have to make sure that all frames we send are
        // complete, i.e., we have to align at the frame byte boundary. Note that
        // the result can be 0 if there is less than this.step bytes of data in the
        // queue.
        const writableLength = Math.min(this._enqueued(), this.requestedBytes);
        const alignedLength = Math.floor(writableLength / this.step) * this.step;

        const data: Buffer[] = [];
        let l = alignedLength;
        while (l) {
            if (l >= this.queue[0].length) {
                l -= this.queue[0].length;
                data.push(this.queue.shift()!);
            } else {
                data.push(this.queue[0].slice(0, l));
                this.queue[0] = this.queue[0].slice(l);
                l = 0;
            }
        }

        if (alignedLength > 0) {
            const packet = new MemoryBlock(this.index, data);
            packet.finalize().forEach(c => this.pa.sock.write(c));
            this.requestedBytes -= alignedLength;
            if (this.left !== null) this.left -= alignedLength;
        }

        if (this.callback) {
            // Invoke the callback if there there is still some space left in the
            // PulseAudio buffer (indicating that we did not have enough data), or if
            // we did not write anything to PulseAudio because we had less than
            // this.step bytes in the internal queue, or if we have reached the
            // maximum number of bytes for the stream.
            if (this.requestedBytes > 0 || alignedLength === 0 || this.left === 0) {
                // Who knows what will be triggered by the callback and when, so first
                // remove it from this object and then invoke it
                const next = this.callback;
                delete this.callback;
                next();
            }
        }
    }

    _write(data: Buffer, encoding: any, next: (error?: Error) => void) {
        if (this.left !== null && (this._enqueued() + data.length > this.left)) {
            next(new Error('Maximum number of bytes for the stream reached'));
            return;
        }

        this.queue.push(data);
        if (typeof this.callback !== 'undefined')
            throw new Error('Bug: Already have a stored callback');
        this.callback = next;
        this._wakeup();
    }

    async _final(done: (error?: Error) => void, cmd = PA_COMMAND.DRAIN_PLAYBACK_STREAM) {
        // Wait for all data to be played out or written to sample cache
        try {
            this.dbg('draining...');
            await this.pa._invoke(new SelectByIndex(cmd, this.index));
            this.dbg(`drained`);
        } catch (error) {
            this.dbg(`drain error: ${error}`);
            done(error as any);
            return;
        }
        done();
    }

    async _destroy(err: Error, callback: (error: Error) => void, cmd = PA_COMMAND.DELETE_PLAYBACK_STREAM) {
        // Destroy the stream immediately without waiting for the data to be played
        // out (drained)
        try {
            this.dbg(`destroying...`);
            await this.pa._invoke(new SelectByIndex(cmd, this.index));
        } catch (error) {
            // For some reason, older PulseAudio versions return the wrong error code PA_ERR_EXIST
            // when the stream being deleted does not exist, so we need to check both
            // error codes here.
            if (!((error as any).code === PA_ERR.NOENTITY || (error as any).code === PA_ERR.EXIST)) {
                this.dbg(`destroy error: ${error}`);
                err = error as any;
            }
        } finally {
            this.dbg(`destroyed`);
            callback(err);
        }
    }
}


export class UploadStream extends PlaybackStream {
    constructor(pulseaudio: PulseAudio, args: any) {
        super(pulseaudio, args);
        this.dbg = logger.extend(`upload:${this.index}`);
    }

    _final(done: () => void) {
        return super._final(done, PA_COMMAND.FINISH_UPLOAD_STREAM);
    }

    _destroy(err: Error, callback: (error: Error) => void) {
        return super._destroy(err, callback, PA_COMMAND.DELETE_UPLOAD_STREAM);
    }
}


export class RecordStream extends Readable {
    pa            : PulseAudio;
    dbg           : debug.Debugger;
    index         : number;
    _running      : boolean;
    left          : number | null;
    maximumLength : number;

    constructor(pulseaudio: PulseAudio, args: any) {
        super({ autoDestroy: true });
        this.pa = pulseaudio;
        this.index = PA_NO_INDEX;
        this.maximumLength = PA_NO_VALUE;
        Object.assign(this, args);

        if (this.index === PA_NO_INDEX)
            throw new Error('RecordStream constructor must be given an index property');

        this.dbg = logger.extend(`record:${this.index}`);
        this._running = false;
        this.left = this.maximumLength !== PA_NO_VALUE ? this.maximumLength : null;
    }

    _onEvent(event: StreamEvent) {
        this.dbg(`${event.type}`);
        this.emit(event.type as string, event);
        if (event.type === 'event')
            this.emit(`${event.type}.${event.event}`, event);

        // Destroy the stream if the corresponding object gets killed on PulseAudio
        // server
        if (event.type === 'killed')
            this.destroy(new Error(`Stream killed on PulseAudio server`));
    }

    _onData(packet: MemoryBlock) {
        if (!this._running) return;

        // MemoryBlock objects received from PulseAudio will always have exactly one
        // block in the body array.
        if (packet.body.length !== 1)
            throw new Error('Unexpected number of body blocks in a MemoryBuffer');

        let data = packet.body[0];
        if (this.left !== null && this.left < data.length)
            data = data.slice(0, this.left);

        if (!this.push(data)) {
            this.dbg(`Data overrun, dropping data from PulseAudio`);
            this.emit('overrun');
            this._running = false;
        }

        if (this.left !== null) {
            this.left -= data.length;
            if (!this.left) {
                this._running = false;
                this.push(null);
            }
        }
    }

    _read() {
        this._running = true;
    }

    async _destroy(err: Error, callback: (error: Error) => void) {
        this._running = false;
        this.dbg(`destroying...`);
        try {
            await this.pa._invoke(new SelectByIndex(PA_COMMAND.DELETE_RECORD_STREAM, this.index));
        } catch (error) {
            // For some reason, PulseAudio returns the wrong error code PA_ERR_EXIST
            // when the stream being deleted does not exist, so we need to check both
            // error codes here.
            if (!((error as any).code === PA_ERR.NOENTITY || (error as any).code === PA_ERR.EXIST)) {
                this.dbg(`destroy error: ${error}`);
                err = error as any;
            }
        } finally {
            this.dbg(`destroyed`);
            this.push(null);
            callback(err);
        }
    }
}
