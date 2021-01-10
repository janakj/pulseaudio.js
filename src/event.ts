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

import { TagStruct } from './packet';
import { PA_NO_TAG } from './defs';
import { Props } from './props';
import { PA_COMMAND } from './command';


enum PA_SUBSCRIPTION_EVENT {
    SINK          = 0x00,  // Event type: Sink
    SOURCE        = 0x01,  // Event type: Source
    SINK_INPUT    = 0x02,  // Event type: Sink input
    SOURCE_OUTPUT = 0x03,  // Event type: Source output
    MODULE        = 0x04,  // Event type: Module
    CLIENT        = 0x05,  // Event type: Client
    SAMPLE_CACHE  = 0x06,  // Event type: Sample cache item
    SERVER        = 0x07,  // Event type: Global server change, only occurring with PA_SUBSCRIPTION_EVENT_CHANGE.
    AUTOLOAD      = 0x08,  // \deprecated Event type: Autoload table changes.
    CARD          = 0x09,  // Event type: Card \since 0.9.15
    FACILITY_MASK = 0x0f,  // A mask to extract the event type from an event value
    NEW           = 0x00,  // A new object was created
    CHANGE        = 0x10,  // A property of the object was modified
    REMOVE        = 0x20,  // An object was removed
    TYPE_MASK     = 0x30   // A mask to extract the event operation from an event value
}

// Must match pulse/def.h

export enum PA_SUBSCRIPTION_MASK {
    NULL          = 0x000,  // No events
    SINK          = 0x001,  // Sink events
    SOURCE        = 0x002,  // Source events
    SINK_INPUT    = 0x004,  // Sink input events
    SOURCE_OUTPUT = 0x008,  // Source output events
    MODULE        = 0x010,  // Module events
    CLIENT        = 0x020,  // Client events
    SAMPLE_CACHE  = 0x040,  // Sample cache events
    SERVER        = 0x080,  // Other global server changes.
    AUTOLOAD      = 0x100,  // \deprecated Autoload table events.
    CARD          = 0x200,  // Card events. \since 0.9.15
    ALL           = 0x2ff   // Catch all events
}


type EventOperation = "new" | "change" | "remove";

function eventOperation(event: number): EventOperation {
    const op = event & PA_SUBSCRIPTION_EVENT.TYPE_MASK;
    switch (op) {
        case PA_SUBSCRIPTION_EVENT.NEW    : return "new";
        case PA_SUBSCRIPTION_EVENT.CHANGE : return "change";
        case PA_SUBSCRIPTION_EVENT.REMOVE : return "remove";
        default: throw new Error(`Unsupported event operation ${op}`);
    }
}


type EventFacility = "sink" | "source" | "sink_input" |
    "source_output" | "module" | "client" | "sample_cache" |
    "server" | "autoload" | "card";

function eventFacility(event: number): EventFacility {
    const facility = event & PA_SUBSCRIPTION_EVENT.FACILITY_MASK;
    switch (facility) {
        case PA_SUBSCRIPTION_EVENT.SINK          : return "sink";
        case PA_SUBSCRIPTION_EVENT.SOURCE        : return "source";
        case PA_SUBSCRIPTION_EVENT.SINK_INPUT    : return "sink_input";
        case PA_SUBSCRIPTION_EVENT.SOURCE_OUTPUT : return "source_output";
        case PA_SUBSCRIPTION_EVENT.MODULE        : return "module";
        case PA_SUBSCRIPTION_EVENT.CLIENT        : return "client";
        case PA_SUBSCRIPTION_EVENT.SAMPLE_CACHE  : return "sample_cache";
        case PA_SUBSCRIPTION_EVENT.SERVER        : return "server";
        case PA_SUBSCRIPTION_EVENT.AUTOLOAD      : return "autoload";
        case PA_SUBSCRIPTION_EVENT.CARD          : return "card";
        default: throw new Error(`Unsupported event facility ${facility}`);
    }
}


export class Event extends TagStruct {
    type: PA_COMMAND | string;

    constructor(header: Buffer | null, body: Buffer | null) {
        super(header, body);
        this.type = this.getUInt32();

        const tag = this.getUInt32();
        if (tag !== PA_NO_TAG)
            throw new Error(`Event packet has the wrong tag ${tag} (expected ${PA_NO_TAG})`);
    }
}


export class SubscribeEvent extends Event {
    event     : number;
    operation : EventOperation;
    facility  : EventFacility;
    index     : number;

    constructor(header: Buffer | null, body: Buffer | null) {
        super(header, body);

        if (this.type !== PA_COMMAND.SUBSCRIBE_EVENT)
            throw new Error(`Subscribe event has the wrong type ${this.type} (expected PA_COMMAND.SUBSCRIBE_EVENT)`);

        this.event = this.getUInt32();
        this.operation = eventOperation(this.event);
        this.facility = eventFacility(this.event);

        this.index = this.getUInt32();
    }
}


// eslint-disable-next-line @typescript-eslint/no-unused-vars
type StreamEventType = "event" | "suspended" | "moved" | "buffer" |
    "killed" | "started" | "overflow" | "request" | "underflow";

export class StreamEvent extends Event {
    index                  : number;
    event?                 : string | null;
    properties?            : Props;
    suspended?             : boolean;
    configuredSinkLatency? : bigint;
    buffer?                : {
        maximumLength?  : number;
        targetLength?   : number;
        preBuffering?   : number;
        minimumRequest? : number;
        fragmentSize?   : number;
    }
    configuredSourceLatency? : bigint;
    requestedBytes?          : number;
    offset?                  : bigint;
    destination?             : {
        index     : number;
        name      : string | null;
        suspended : boolean;
    }

    constructor(header: Buffer | null, body: Buffer | null) {
        super(header, body);
        this.index = this.getUInt32();

        switch (this.type) {
            case PA_COMMAND.PLAYBACK_STREAM_EVENT:
            case PA_COMMAND.RECORD_STREAM_EVENT:
                this.type = 'event';
                this.event = this.getString();
                this.properties = this.getProps();
                break;

            case PA_COMMAND.PLAYBACK_STREAM_SUSPENDED:
            case PA_COMMAND.RECORD_STREAM_SUSPENDED:
                this.type = 'suspended';
                this.suspended = this.getBool();
                break;

            case PA_COMMAND.PLAYBACK_STREAM_MOVED:
                this.parseDestination();
                this.parsePlaybackBuffer();
                this.configuredSinkLatency = this.getUsec();
                this.type = 'moved';
                break;

            case PA_COMMAND.PLAYBACK_BUFFER_ATTR_CHANGED:
                this.parsePlaybackBuffer();
                this.configuredSinkLatency = this.getUsec();
                this.type = 'buffer';
                break;

            case PA_COMMAND.RECORD_STREAM_MOVED:
                this.parseDestination();
                this.buffer = {
                    maximumLength: this.getUInt32(),
                    fragmentSize: this.getUInt32()
                }
                this.configuredSourceLatency = this.getUsec();
                this.type = 'moved';
                break;

            case PA_COMMAND.PLAYBACK_STREAM_KILLED:
            case PA_COMMAND.RECORD_STREAM_KILLED:
                this.type = 'killed';
                break;

            case PA_COMMAND.STARTED:
                this.type = 'started';
                break;

            case PA_COMMAND.OVERFLOW:
                this.type = 'overflow';
                break;

            case PA_COMMAND.REQUEST:
                this.requestedBytes = this.getUInt32();
                this.type = 'request';
                break;

            case PA_COMMAND.UNDERFLOW:
                this.offset = this.getSInt64();
                this.type = 'underflow';
                break;

            default:
                throw new Error(`Unsupported stream event type ${this.type}`);
        }
    }

    parsePlaybackBuffer() {
        this.buffer = {
            maximumLength  : this.getUInt32(),
            targetLength   : this.getUInt32(),
            preBuffering   : this.getUInt32(),
            minimumRequest : this.getUInt32()
        }
    }

    parseDestination() {
        this.destination = {
            index     : this.getUInt32(),
            name      : this.getString(),
            suspended : this.getBool()
        }
    }
}
