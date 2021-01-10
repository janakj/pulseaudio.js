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

// Must match pulse/channelmap.{c,h}

enum PA_CHANNEL {
    POSITION_INVALID = -1,
    POSITION_MONO = 0,

    POSITION_FRONT_LEFT,   // Apple, Dolby call this 'Left'
    POSITION_FRONT_RIGHT,  // Apple, Dolby call this 'Right'
    POSITION_FRONT_CENTER, // Apple, Dolby call this 'Center'

    POSITION_REAR_CENTER, // Microsoft calls this 'Back Center', Apple calls this 'Center Surround', Dolby calls this 'Surround Rear Center'
    POSITION_REAR_LEFT,   // Microsoft calls this 'Back Left', Apple calls this 'Left Surround' (!), Dolby calls this 'Surround Rear Left'
    POSITION_REAR_RIGHT,  // Microsoft calls this 'Back Right', Apple calls this 'Right Surround' (!), Dolby calls this 'Surround Rear Right'

    POSITION_LFE, // Microsoft calls this 'Low Frequency', Apple calls this 'LFEScreen'

    POSITION_FRONT_LEFT_OF_CENTER,  // Apple, Dolby call this 'Left Center'
    POSITION_FRONT_RIGHT_OF_CENTER, // Apple, Dolby call this 'Right Center

    POSITION_SIDE_LEFT,  // Apple calls this 'Left Surround Direct', Dolby calls this 'Surround Left' (!)
    POSITION_SIDE_RIGHT, // Apple calls this 'Right Surround Direct', Dolby calls this 'Surround Right' (!)

    POSITION_AUX0,
    POSITION_AUX1,
    POSITION_AUX2,
    POSITION_AUX3,
    POSITION_AUX4,
    POSITION_AUX5,
    POSITION_AUX6,
    POSITION_AUX7,
    POSITION_AUX8,
    POSITION_AUX9,
    POSITION_AUX10,
    POSITION_AUX11,
    POSITION_AUX12,
    POSITION_AUX13,
    POSITION_AUX14,
    POSITION_AUX15,
    POSITION_AUX16,
    POSITION_AUX17,
    POSITION_AUX18,
    POSITION_AUX19,
    POSITION_AUX20,
    POSITION_AUX21,
    POSITION_AUX22,
    POSITION_AUX23,
    POSITION_AUX24,
    POSITION_AUX25,
    POSITION_AUX26,
    POSITION_AUX27,
    POSITION_AUX28,
    POSITION_AUX29,
    POSITION_AUX30,
    POSITION_AUX31,

    POSITION_TOP_CENTER, // Apple calls this 'Top Center Surround'

    POSITION_TOP_FRONT_LEFT,   // Apple calls this 'Vertical Height Left'
    POSITION_TOP_FRONT_RIGHT,  // Apple calls this 'Vertical Height Right'
    POSITION_TOP_FRONT_CENTER, // Apple calls this 'Vertical Height Center'

    POSITION_TOP_REAR_LEFT,   // Microsoft and Apple call this 'Top Back Left'
    POSITION_TOP_REAR_RIGHT,  // Microsoft and Apple call this 'Top Back Right'
    POSITION_TOP_REAR_CENTER, // Microsoft and Apple call this 'Top Back Center'

    POSITION_MAX
}


export function wavToChannelMap(channels: number) {
    /* Following http://www.microsoft.com/whdc/device/audio/multichaud.mspx#EKLAC */

    const map = Array(channels);
    switch (channels) {
        case 1:
            map[0] = PA_CHANNEL.POSITION_MONO;
            return map;

        case 18:
            map[15] = PA_CHANNEL.POSITION_TOP_REAR_LEFT;
            map[16] = PA_CHANNEL.POSITION_TOP_REAR_CENTER;
            map[17] = PA_CHANNEL.POSITION_TOP_REAR_RIGHT;
        /* Fall through */

        case 15:
            map[12] = PA_CHANNEL.POSITION_TOP_FRONT_LEFT;
            map[13] = PA_CHANNEL.POSITION_TOP_FRONT_CENTER;
            map[14] = PA_CHANNEL.POSITION_TOP_FRONT_RIGHT;
        /* Fall through */

        case 12:
            map[11] = PA_CHANNEL.POSITION_TOP_CENTER;
        /* Fall through */

        case 11:
            map[9] = PA_CHANNEL.POSITION_SIDE_LEFT;
            map[10] = PA_CHANNEL.POSITION_SIDE_RIGHT;
        /* Fall through */

        case 9:
            map[8] = PA_CHANNEL.POSITION_REAR_CENTER;
        /* Fall through */

        case 8:
            map[6] = PA_CHANNEL.POSITION_FRONT_LEFT_OF_CENTER;
            map[7] = PA_CHANNEL.POSITION_FRONT_RIGHT_OF_CENTER;
        /* Fall through */

        case 6:
            map[4] = PA_CHANNEL.POSITION_REAR_LEFT;
            map[5] = PA_CHANNEL.POSITION_REAR_RIGHT;
        /* Fall through */

        case 4:
            map[3] = PA_CHANNEL.POSITION_LFE;
        /* Fall through */

        case 3:
            map[2] = PA_CHANNEL.POSITION_FRONT_CENTER;
        /* Fall through */

        case 2:
            map[0] = PA_CHANNEL.POSITION_FRONT_LEFT;
            map[1] = PA_CHANNEL.POSITION_FRONT_RIGHT;
            return map;

        default:
            throw new Error(`Unsupported number of channels ${channels}`);
    }
}
