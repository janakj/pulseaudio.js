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

import debug from 'debug';
import { homedir } from 'os';

export const logger = debug('pa');

export const PA_MAX_CHANNELS = 32;
export const PA_DEFAULT_SOURCE = '@DEFAULT_SOURCE@';
export const PA_DEFAULT_SINK = '@DEFAULT_SINK@';

export const PA_NO_VALUE = 0xffffffff;
export const PA_NO_INDEX = PA_NO_VALUE;
export const PA_NO_TAG = PA_NO_VALUE;

export const PA_NATIVE_COOKIE_LENGTH = 256;

// The minimal PulseAudio native protocol version required by this client.
export const PA_NATIVE_PROTOCOL_VERSION = 32;

export const defaultSockPath = `/run/user/${process.getuid()}/pulse/native`;
export const cookieFile = `${homedir()}/.config/pulse/cookie`;

// Must match pulse/def.h

export enum PA_SINK_FLAGS {
    NOFLAGS         = 0x000, // Flag to pass when no specific options are needed (used to avoid casting)  \since 0.9.19
    HW_VOLUME_CTRL  = 0x001, // Supports hardware volume control. This is a dynamic flag and may change at runtime after the sink has initialized
    LATENCY         = 0x002, // Supports latency querying
    HARDWARE        = 0x004, // Is a hardware sink of some kind, in contrast to "virtual"/software sinks \since 0.9.3
    NETWORK         = 0x008, // Is a networked sink of some kind. \since 0.9.7
    HW_MUTE_CTRL    = 0x010, // Supports hardware mute control. This is a dynamic flag and may change at runtime after the sink has initialized \since 0.9.11
    DECIBEL_VOLUME  = 0x020, // Volume can be translated to dB with pa_sw_volume_to_dB(). This is a dynamic flag and may change at runtime after the sink has initialized \since 0.9.11
    FLAT_VOLUME     = 0x040, // This sink is in flat volume mode, i.e.\ always the maximum of the volume of all connected inputs. \since 0.9.15
    DYNAMIC_LATENCY = 0x080, // The latency can be adjusted dynamically depending on the needs of the connected streams. \since 0.9.15
    SET_FORMATS     = 0x100  // The sink allows setting what formats are supported by the connected hardware. The actual functionality to do this might be provided by an extension. \since 1.0
}


export enum PA_SOURCE_FLAGS {
    NOFLAGS         = 0x00, // Flag to pass when no specific options are needed (used to avoid casting)  \since 0.9.19
    HW_VOLUME_CTRL  = 0x01, // Supports hardware volume control. This is a dynamic flag and may change at runtime after the source has initialized
    LATENCY         = 0x02, // Supports latency querying
    HARDWARE        = 0x04, // Is a hardware source of some kind, in contrast to "virtual"/software source \since 0.9.3
    NETWORK         = 0x08, // Is a networked source of some kind. \since 0.9.7
    HW_MUTE_CTRL    = 0x10, // Supports hardware mute control. This is a dynamic flag and may change at runtime after the source has initialized \since 0.9.11
    DECIBEL_VOLUME  = 0x20, // Volume can be translated to dB with pa_sw_volume_to_dB(). This is a dynamic flag and may change at runtime after the source has initialized \since 0.9.11
    DYNAMIC_LATENCY = 0x40, // The latency can be adjusted dynamically depending on the needs of the connected streams. \since 0.9.15
    FLAT_VOLUME     = 0x80  // This source is in flat volume mode, i.e.\ always the maximum of the volume of all connected outputs. \since 1.0
}


export enum PA_SAMPLE_FORMAT {
    U8,        // Unsigned 8 Bit PCM
    ALAW,      // 8 Bit a-Law
    ULAW,      // 8 Bit mu-Law
    S16LE,     // Signed 16 Bit PCM, little endian (PC)
    S16BE,     // Signed 16 Bit PCM, big endian
    FLOAT32LE, // 32 Bit IEEE floating point, little endian (PC), range -1.0 to 1.0
    FLOAT32BE, // 32 Bit IEEE floating point, big endian, range -1.0 to 1.0
    S32LE,     // Signed 32 Bit PCM, little endian (PC)
    S32BE,     // Signed 32 Bit PCM, big endian
    S24LE,     // Signed 24 Bit PCM packed, little endian (PC). \since 0.9.15
    S24BE,     // Signed 24 Bit PCM packed, big endian. \since 0.9.15
    S24_32LE,  // Signed 24 Bit PCM in LSB of 32 Bit words, little endian (PC). \since 0.9.15
    S24_32BE   // Signed 24 Bit PCM in LSB of 32 Bit words, big endian. \since 0.9.15
}
