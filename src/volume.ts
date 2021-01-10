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

// Must match pulse/volume.{h,c}

export const PA_VOLUME_MUTED = 0;             // 0% (-inf dB)
export const PA_VOLUME_NORM = 0x10000;        // 100% (0 dB)
export const PA_VOLUME_MAX = 0x7fffffff;      // UINT32_MAX / 2
export const PA_VOLUME_INVALID = 0xffffffff;  // Special invalid volume value


function clampVolume(v: number) {
    if (v < PA_VOLUME_MUTED) return PA_VOLUME_MUTED;
    if (v > PA_VOLUME_MAX) return PA_VOLUME_MAX;
    return v;
}

const linearTodB = (v: number) => 20 * Math.log10(v);
const dBToLinear = (v: number) => 10 ** (v / 20);


function linearToVolume(v: number) {
    // We use a cubic mapping here, as suggested and discussed here:
    // http://www.robotplanet.dk/audio/audio_gui_design/
    // http://lists.linuxaudio.org/pipermail/linux-audio-dev/2009-May/thread.html#23151
    //
    // We make sure that the conversion to linear and back yields the same volume
    // value! That's why we need the lround() below!

    if (v <= 0) return PA_VOLUME_MUTED;
    return clampVolume(Math.round(Math.cbrt(v) * PA_VOLUME_NORM));
}


function volumeToLinear(v: number) {
    if (v > PA_VOLUME_MAX) return 0;
    if (v <= PA_VOLUME_MUTED) return 0;
    if (v === PA_VOLUME_NORM) return 1;

    v /= PA_VOLUME_NORM;
    return v * v * v;
}


export function dBToVolume(v: number) {
    if (v === Number.NEGATIVE_INFINITY) return PA_VOLUME_MUTED;
    return linearToVolume(dBToLinear(v));
}


export function volumeTodB(v: number) {
    if (v > PA_VOLUME_MAX || v <= PA_VOLUME_MUTED)
        return Number.NEGATIVE_INFINITY;
    return linearTodB(volumeToLinear(v));
}


export function volumeToPercent(v: number) {
    if (v > PA_VOLUME_MAX || v < PA_VOLUME_MUTED)
        return Number.NaN;
    return v / PA_VOLUME_NORM * 100;
}


export function percentToVolume(v: number) {
    return clampVolume(Math.round(v / 100 * (PA_VOLUME_NORM - PA_VOLUME_MUTED) + PA_VOLUME_MUTED));
}


export function dBToPercent(v: number) {
    return volumeToPercent(dBToVolume(v));
}


export function percentTodB(v: number) {
    return volumeTodB(percentToVolume(v));
}