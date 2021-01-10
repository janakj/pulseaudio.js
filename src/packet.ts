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

import { PA_MAX_CHANNELS, PA_SAMPLE_FORMAT } from './defs';
import { FlatProps, Props, inflate, deflate } from './props';

// A fixed-size descriptor that must be transmitted at the beginning of each
// packet. The descriptor consists of 5 32-bit integers in network byte order.
// The first integer contains the length of the packet without the descriptor.
// The second integer is a channel number. The channel number is only used in
// memory block packets. In other cases it is set to PA_NO_INDEX. The third
// and fourth integers are memory block address offsets. The fifth integer
// carries various flags and is set to 0 by default.
//
// Must match pulsecore/pstream.{h,c}

export enum PA_STREAM_DESCRIPTOR {
    LENGTH,
    CHANNEL,
    OFFSET_HI,
    OFFSET_LO,
    FLAGS,
    MAX
}

export const PA_STREAM_DESCRIPTOR_SIZE = PA_STREAM_DESCRIPTOR.MAX * 4;


export interface SampleSpec {
    format   : number;
    channels : number;
    rate     : number;
}


class Packet {
    header: Buffer;
    constructor(header? : Buffer | null) {
        if (typeof header === 'undefined' || header === null) {
            this.header = Buffer.alloc(PA_STREAM_DESCRIPTOR_SIZE);
        } else if (Buffer.isBuffer(header)) {
            this.header = header;
        } else {
            throw new Error(`Unsupported argument type (must be a Buffer)`);
        }
    }

    setChannel(channel: number) {
        this.header.writeUInt32BE(channel, PA_STREAM_DESCRIPTOR.CHANNEL * 4);
    }

    setLength(length: number) {
        this.header.writeUInt32BE(length, PA_STREAM_DESCRIPTOR.LENGTH * 4);
    }

    finalize() {
        return [this.header];
    }
}


export class MemoryBlock extends Packet {
    body: Buffer[];

    constructor(headerOrChannel: Buffer | number, body: Buffer | Buffer[]) {
        if (Buffer.isBuffer(body)) {
            body = [body];
        } else if (!Array.isArray(body)) {
            throw new Error('MemoryBlock body must be a Buffer or array of Buffers');
        }

        if (typeof headerOrChannel === 'number') {
            // The first argument is channel number, the second argument is either a
            // single block or an array of blocks. This variant is used in
            // PlaybackStream to send memory blocks to PulseAudio servers.

            super();
            this.setChannel(headerOrChannel);
            this.setLength(body.reduce((a, v) => a + v.length, 0));
        } else if (Buffer.isBuffer(headerOrChannel)) {
            // The first argument is a Buffer holding the packet's header. This
            // variant is used for memory blocks incoming from PulseAudio server.

            super(headerOrChannel);
        } else {
            throw new Error(`Invalid arguments to MemoryBlock constructor`);
        }

        this.body = body;
    }

    finalize() {
        return super.finalize().concat(this.body);
    }
}


// Must match pulsecore/tagstruct.h
export enum PA_TAG {
    INVALID       = 0,
    STRING        = 't'.charCodeAt(0),
    STRING_NULL   = 'N'.charCodeAt(0),
    U32           = 'L'.charCodeAt(0),
    U8            = 'B'.charCodeAt(0),
    U64           = 'R'.charCodeAt(0),
    S64           = 'r'.charCodeAt(0),
    SAMPLE_SPEC   = 'a'.charCodeAt(0),
    ARBITRARY     = 'x'.charCodeAt(0),
    BOOLEAN_TRUE  = '1'.charCodeAt(0),
    BOOLEAN_FALSE = '0'.charCodeAt(0),
    TIMEVAL       = 'T'.charCodeAt(0),
    USEC          = 'U'.charCodeAt(0),  // 64 bit unsigned
    CHANNEL_MAP   = 'm'.charCodeAt(0),
    CVOLUME       = 'v'.charCodeAt(0),
    PROPLIST      = 'P'.charCodeAt(0),
    VOLUME        = 'V'.charCodeAt(0),
    FORMAT_INFO   = 'f'.charCodeAt(0)
}


export class TagStruct extends Packet {
    static FRAGMENT_SIZE = 64;
    body : Buffer;
    i    : number;

    constructor(header?: Buffer | null, body? : Buffer | null) {
        super(header);
        if (typeof body === 'undefined' || body === null) {
            // This variant is used when were are creating a new command packet from
            // scratch. This is used in the code that sends commands to PulseAudio
            // server.
            this.body = Buffer.allocUnsafe(TagStruct.FRAGMENT_SIZE);
        } else if (Buffer.isBuffer(body)) {
            this.body = body;
        } else {
            throw new Error('Invalid body argument to TagStruct');
        }

        // Read and write index into the buffer.
        this.i = 0;
    }

    alloc(wanted: number) {
        const missing = wanted - this.body.length + this.i;
        if (missing <= 0) return;

        const n = missing / TagStruct.FRAGMENT_SIZE +
            ((missing % TagStruct.FRAGMENT_SIZE > 0) ? 1 : 0);

        const buf = Buffer.allocUnsafe(this.body.length + n * TagStruct.FRAGMENT_SIZE);
        this.body.copy(buf, 0, 0, this.i);
        this.body = buf;
    }

    assert(wanted: number) {
        if (this.body.length - this.i < wanted)
            throw new Error(`Packet too short (wanted ${wanted} bytes)`);
    }

    finalize() {
        this.setLength(this.i);
        return super.finalize().concat(this.body.slice(0, this.i));
    }

    addUInt8(value: number) {
        this.alloc(2);
        this.body[this.i++] = PA_TAG.U8;
        this.body[this.i++] = value;
    }

    getUInt8() {
        this.assert(2);
        if (this.body[this.i] !== PA_TAG.U8)
            throw new Error(`Invalid tag ${this.body[this.i]}, expected PA_TAG.U8`);
        this.i++;
        return this.body.readUInt8(this.i++);
    }

    addUInt32(value: number) {
        this.alloc(5);
        this.body[this.i++] = PA_TAG.U32;
        this.i = this.body.writeUInt32BE(value, this.i);
    }

    getUInt32() {
        this.assert(5);
        if (this.body[this.i] !== PA_TAG.U32)
            throw new Error(`Invalid tag ${this.body[this.i]}, expected PA_TAG.U32`);
        const rv = this.body.readUInt32BE(this.i + 1);
        this.i += 5;
        return rv;
    }

    addUInt64(value: number | BigInt) {
        this.alloc(9);
        this.body[this.i++] = PA_TAG.U64;
        // eslint-disable-next-line no-undef
        this.i = this.body.writeBigInt64BE(BigInt(value), this.i);
    }

    getUInt64() {
        this.assert(9);
        if (this.body[this.i] !== PA_TAG.U64)
            throw new Error(`Invalid tag ${this.body[this.i]}, expected PA_TAG.U64`);
        const rv = this.body.readBigUInt64BE(this.i + 1);
        this.i += 9;
        return rv;
    }

    getSInt64() {
        this.assert(9);
        if (this.body[this.i] !== PA_TAG.S64)
            throw new Error(`Invalid tag ${this.body[this.i]}, expected PA_TAG.S64`);
        const rv = this.body.readBigInt64BE(this.i + 1);
        this.i += 9;
        return rv;
    }

    getUsec() {
        this.assert(9);
        if (this.body[this.i] !== PA_TAG.USEC)
            throw new Error(`Invalid tag ${this.body[this.i]}, expected PA_TAG.USEC`);
        this.i++;
        const rv = this.body.readBigInt64BE();
        this.i += 8;
        return rv;
    }

    static stringLength(value: string | null) {
        if (value === null) return 1;
        return 2 + Buffer.byteLength(value);
    }

    addString(value: string | null) {
        this.alloc(TagStruct.stringLength(value));
        if (value !== null) {
            if (typeof value !== 'string')
                throw new Error('PA_TAG.STRING value must be a string or null');

            this.body[this.i++] = PA_TAG.STRING;
            this.i += this.body.write(value, this.i);
            this.body[this.i++] = 0;
        } else {
            this.body[this.i++] = PA_TAG.STRING_NULL;
        }
    }

    getString() {
        this.assert(1);
        if (this.body[this.i] === PA_TAG.STRING_NULL) {
            this.i++;
            return null;
        }

        if (this.body[this.i] === PA_TAG.STRING) {
            this.i++;
            let j = this.i;
            for (; j < this.body.length; j++) {
                if (this.body[j] === 0) break;
            }
            if (j === this.body.length)
                throw new Error('Unterminated string tag');

            const rv = this.body.toString('utf8', this.i, j);
            this.i = j + 1;
            return rv;
        }

        throw new Error(`Invalid tag ${this.body[this.i]}, expected PA_TAG.STRING_NULL or PA_TAG.STRING`);
    }

    addArbitrary(value: Buffer) {
        if (!Buffer.isBuffer(value))
            throw new Error(`Value for PA_TAG.ARBITRARY must be a buffer`);

        this.alloc(value.length + 5);
        this.body[this.i++] = PA_TAG.ARBITRARY;
        this.i = this.body.writeUInt32BE(value.length, this.i);
        if (value.length)
            this.i += value.copy(this.body, this.i);
    }

    getArbitrary() {
        this.assert(5);
        if (this.body[this.i] !== PA_TAG.ARBITRARY)
            throw new Error(`Invalid tag ${this.body[this.i]}, expected PA_TAG.ARBITRARY`);
        this.i++;
        const len = this.body.readUInt32BE(this.i);
        this.i += 4;

        let data;
        if (len > 0) {
            this.assert(len);
            data = Buffer.from(this.body.buffer, this.body.byteOffset + this.i, len);
        } else {
            data = Buffer.alloc(0);
        }

        this.i += len;
        return data;
    }

    addBool(value: boolean) {
        this.alloc(1);
        this.body[this.i++] = value ? PA_TAG.BOOLEAN_TRUE : PA_TAG.BOOLEAN_FALSE;
    }

    getBool() {
        this.assert(1);
        let val;
        if (this.body[this.i] === PA_TAG.BOOLEAN_TRUE) val = true;
        else if (this.body[this.i] === PA_TAG.BOOLEAN_FALSE) val = false;
        else throw new Error(`Invalid tag ${this.body[this.i]}, expected PA_TAG.BOOLEAN_{TRUE,FALSE}`);
        this.i++;
        return val;
    }

    static propsLength(props: FlatProps) {
        let rv = 1;
        for (const [key, val] of Object.entries(props)) {
            rv += TagStruct.stringLength(key);
            rv += 5;
            rv += 5 + val.length + 1;
        }
        rv += 1;
        return rv;
    }

    addProps(props: Props) {
        const p = deflate(props);
        this.alloc(TagStruct.propsLength(p));
        this.body[this.i++] = PA_TAG.PROPLIST;
        for (const [key, val] of Object.entries(p)) {
            this.addString(key);

            const buf = Buffer.allocUnsafe(val.length + 1);
            buf.write(val);
            buf[val.length] = 0;
            this.addUInt32(buf.length);
            this.addArbitrary(buf);
        }
        this.addString(null);
    }

    getProps() {
        this.assert(1);
        if (this.body[this.i] !== PA_TAG.PROPLIST)
            throw new Error(`Invalid tag ${this.body[this.i]}, expected PA_TAG.PROPLIST`);

        this.i++;
        const props = Object.create(null);
        let key = this.getString();

        while (key !== null) {
            this.getUInt32();
            const val = this.getArbitrary();
            // Prop value strings include zero terminators. Do not copy that into the
            // returned string
            props[key] = val.toString('utf8', 0, val.length - 1);

            key = this.getString();
        }

        return inflate(props);
    }

    static cvolumeLength(volumes: number[]) {
        return 2 + volumes.length * 4;
    }

    addCvolume(volumes: number[]) {
        this.alloc(TagStruct.cvolumeLength(volumes));
        this.body[this.i++] = PA_TAG.CVOLUME;
        this.body[this.i++] = volumes.length;
        for (const volume of volumes)
            this.i = this.body.writeUInt32BE(volume, this.i);
    }

    getCvolume() {
        this.assert(2);
        if (this.body[this.i] !== PA_TAG.CVOLUME)
            throw new Error(`Invalid tag ${this.body[this.i]}, expected PA_TAG.CVOLUME`);
        this.i++;
        const len = this.body[this.i++];

        this.assert(len * 4);
        const rv: number[] = [];
        for (let i = 0; i < len; i++) {
            rv.push(this.body.readUInt32BE(this.i));
            this.i += 4;
        }
        return rv;
    }

    addVolume(volume: number) {
        this.alloc(5);
        this.body[this.i++] = PA_TAG.VOLUME;
        this.i = this.body.writeUInt32BE(volume, this.i);
    }

    getVolume() {
        this.assert(5);
        if (this.body[this.i] !== PA_TAG.VOLUME)
            throw new Error(`Invalid tag ${this.body[this.i]}, expected PA_TAG.VOLUME`);
        const rv = this.body.readUInt32BE(this.i + 1);
        this.i += 5;
        return rv;
    }

    static sampleSpecLength() {
        return 7;
    }

    addSampleSpec({ format, channels, rate }: SampleSpec) {
        this.alloc(TagStruct.sampleSpecLength());
        this.body[this.i++] = PA_TAG.SAMPLE_SPEC;

        if (typeof format !== 'number')
            throw new Error(`Sample format must be a number`);

        if (!(format in PA_SAMPLE_FORMAT))
            throw new Error(`Invalid sample format ${format}`);
        this.body[this.i++] = format;

        if (typeof channels !== 'number')
            throw new Error(`Number of channels must be a number`);

        if (channels < 0 || channels >= PA_MAX_CHANNELS)
            throw new Error(`Invalid number of channels: ${channels}`);
        this.body[this.i++] = channels;

        this.i = this.body.writeUInt32BE(rate, this.i);
    }

    getSampleSpec(): SampleSpec {
        this.assert(TagStruct.sampleSpecLength());
        if (this.body[this.i] !== PA_TAG.SAMPLE_SPEC)
            throw new Error(`Invalid tag ${this.body[this.i]}, expected PA_TAG.SAMPLE_SPEC`);
        this.i++;

        const rv = {
            format   : this.body[this.i++],
            channels : this.body[this.i++],
            rate     : this.body.readUInt32BE(this.i)
        }
        this.i += 4;
        return rv;
    }

    static channelMapLength(map: number[]) {
        if (!Array.isArray(map))
            throw new Error('Channel map must be an array');

        if (map.length > 255)
            throw new Error(`More than 255 channels in channel map: ${map.length}`);

        return 2 + map.length;
    }

    addChannelMap(map: number[]) {
        this.alloc(TagStruct.channelMapLength(map));
        this.body[this.i++] = PA_TAG.CHANNEL_MAP;
        this.body[this.i++] = map.length;
        for (let j = 0; j < map.length; j++)
            this.body[this.i++] = map[j];
    }

    getChannelMap() {
        this.assert(2);
        if (this.body[this.i] !== PA_TAG.CHANNEL_MAP)
            throw new Error(`Invalid tag ${this.body[this.i]}, expected PA_TAG.CHANNEL_MAP`);
        this.i++;

        const channels = this.body[this.i++];
        this.assert(channels);

        let j = 0;
        const map: number[] = [];
        for (; j < channels; j++) map.push(this.body[this.i + j]);
        this.i += j;
        return map;
    }

    getFormatInfo() {
        this.assert(1)
        if (this.body[this.i] !== PA_TAG.FORMAT_INFO)
            throw new Error(`Invalid tag ${this.body[this.i]}, expected PA_TAG.FORMAT_INFO`);
        this.i++;
        return {
            encoding   : this.getUInt8(),
            properties : this.getProps()
        }
    }

    addFormatInfo(encoding: number, props = {}) {
        this.alloc(1);
        this.body[this.i++] = PA_TAG.FORMAT_INFO;
        this.addUInt8(encoding);
        this.addProps(props);
    }
}
