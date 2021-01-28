# PulseAudio.js
[![NPM](https://img.shields.io/npm/v/@janakj/pulseaudio.js.svg?logo=npm&logoColor=fff&label=NPM+package&color=limegreen)](https://www.npmjs.com/package/@janakj/pulseaudio.js)

PulseAudio.js is a fully-featured JavaScript (TypeScript) client library for [PulseAudio](https://www.freedesktop.org/wiki/Software/PulseAudio), the sound system used by modern Linux distributions. The client can be used to configure and control the PulseAudio server, play or record audio, and much more. The library is entirely implemented in TypeScript and has no external native dependendencies. It communicates with the server using the PulseAudio native protocol over a UNIX domain socket. 

The library requires PulseAudio 10.0 or higher (PulseAudio native protocol version 32 or higher).

PulseAudio.js is free software licensed under the [ISC license](LICENSE).

# Main Features

- Asynchronous Promise-based API with TypeScript type declarations
- Low-latency [audio playback and recording](https://github.com/janakj/pulseaudio.js/wiki/Recording-&-Playback) integrated with the Node.js [stream](https://nodejs.org/api/stream.html) API
- PulseAudio source, sink, and stream [introspection](https://github.com/janakj/pulseaudio.js/wiki/Server-Info) and [volume control](https://github.com/janakj/pulseaudio.js/wiki/Volume-Control)
- Sample cache [management & playback](https://github.com/janakj/pulseaudio.js/wiki/Sample-Cache)
- Module [loading & unloading](https://github.com/janakj/pulseaudio.js/wiki/Loading-Modules) on the PulseAudio server (can be used to create virtual sources and sinks)
- Support for [asynchronous event notifications](https://github.com/janakj/pulseaudio.js/wiki/Event-Notification) sent by the PulseAudio server

# Installation & Basic Usage

```bash
npm install @janakj/pulseaudio.js
```
```javascript
import { PulseAudio } from '@janakj/pulseaudio.js';

const pa = new PulseAudio();

(async function() {
    await pa.connect();
    console.log(await pa.getServerInfo());
    await pa.disconnect();
}());
```

# Documentation

Please refer to the [wiki](https://github.com/janakj/pulseaudio.js/wiki) for documentation and usage examples.
