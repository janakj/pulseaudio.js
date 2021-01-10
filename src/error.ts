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

// Must match pulse/def.h

import type { TagStruct } from './packet';


export enum PA_ERR {
    OK,                   // No error
    ACCESS,               // Access failure
    COMMAND,              // Unknown command
    INVALID,              // Invalid argument
    EXIST,                // Entity exists
    NOENTITY,             // No such entity
    CONNECTIONREFUSED,    // Connection refused
    PROTOCOL,             // Protocol error
    TIMEOUT,              // Timeout
    AUTHKEY,              // No authentication key
    INTERNAL,             // Internal error
    CONNECTIONTERMINATED, // Connection terminated
    KILLED,               // Entity killed
    INVALIDSERVER,        // Invalid server
    MODINITFAILED,        // Module initialization failed
    BADSTATE,             // Bad state
    NODATA,               // No data
    VERSION,              // Incompatible protocol version
    TOOLARGE,             // Data too large
    NOTSUPPORTED,         // Operation not supported \since 0.9.5
    UNKNOWN,              // The error code was unknown to the client
    NOEXTENSION,          // Extension does not exist. \since 0.9.12
    OBSOLETE,             // Obsolete functionality. \since 0.9.15
    NOTIMPLEMENTED,       // Missing implementation. \since 0.9.15
    FORKED,               // The caller forked without calling execve() and tried to reuse the context. \since 0.9.15
    IO,                   // An IO error happened. \since 0.9.16
    BUSY                  // Device or resource busy. \since 0.9.17
}


// Must match pulse/error.c

const paErrorToStr = {
    [PA_ERR.OK]                   : "OK",
    [PA_ERR.ACCESS]               : "Access denied",
    [PA_ERR.COMMAND]              : "Unknown command",
    [PA_ERR.INVALID]              : "Invalid argument",
    [PA_ERR.EXIST]                : "Entity exists",
    [PA_ERR.NOENTITY]             : "No such entity",
    [PA_ERR.CONNECTIONREFUSED]    : "Connection refused",
    [PA_ERR.PROTOCOL]             : "Protocol error",
    [PA_ERR.TIMEOUT]              : "Timeout",
    [PA_ERR.AUTHKEY]              : "No authentication key",
    [PA_ERR.INTERNAL]             : "Internal error",
    [PA_ERR.CONNECTIONTERMINATED] : "Connection terminated",
    [PA_ERR.KILLED]               : "Entity killed",
    [PA_ERR.INVALIDSERVER]        : "Invalid server",
    [PA_ERR.MODINITFAILED]        : "Module initialization failed",
    [PA_ERR.BADSTATE]             : "Bad state",
    [PA_ERR.NODATA]               : "No data",
    [PA_ERR.VERSION]              : "Incompatible protocol version",
    [PA_ERR.TOOLARGE]             : "Too large",
    [PA_ERR.NOTSUPPORTED]         : "Not supported",
    [PA_ERR.UNKNOWN]              : "Unknown error code",
    [PA_ERR.NOEXTENSION]          : "No such extension",
    [PA_ERR.OBSOLETE]             : "Obsolete functionality",
    [PA_ERR.NOTIMPLEMENTED]       : "Missing implementation",
    [PA_ERR.FORKED]               : "Client forked",
    [PA_ERR.IO]                   : "Input/Output error",
    [PA_ERR.BUSY]                 : "Device or resource busy"
}


export class PulseError extends Error {
    code: number;
    constructor(packet: TagStruct) {
        const code = packet.getUInt32() as PA_ERR;
        super(paErrorToStr[code] || `Uknown Pulseaudio error code ${code}`);
        this.code = code;
    }
}
