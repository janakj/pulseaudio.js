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

export interface FlatProps {
    [key: string]: string;
}


export interface Props {
    [key: string]: string | Props;
}


// Convert a tree of properties such as
// {
//   application : {
//     name : 'User Terminal',
//     id : 'user-terminal',
//     version : '1.0',
//     process : {
//       id : '40204',
//       binary : 'ut',
//       user : 'root',
//       host : 'ut3',
//       machine_id : '13123214124'
//     }
//   }
// }
//
// into a flat object such as
// {
//  'application.name': 'User Terminal',
//  'application.id': 'user-terminal',
//  'application.version': '1.0',
//  'application.process.id': '40204',
//  'application.process.binary': 'ut',
//  'application.process.user': 'root',
//  'application.process.host': 'ut3',
//  'application.process.machine_id': '13123214124'
// }
//
// and vice versa. Non-string values are implicitly converted to string by deflate.


export function deflate(props: Props, res: any = {}, prefix = ''): FlatProps {
    for (const [key, val] of Object.entries(props)) {
        if (typeof val === 'object' && !Array.isArray(val) && val !== null)
            deflate(props[key] as Props, res, `${prefix}${key}.`);
        else
            res[`${prefix}${key}`] = `${val}`;
    }
    return res;
}


export function inflate(props: FlatProps): Props {
    const res: any = {};
    for (const [key, val] of Object.entries(props)) {
        const c = key.split('.');
        let l = res;
        for (let i = 0; i < c.length - 1; i++) {
            if (!(c[i] in l)) l[c[i]] = {};
            l = l[c[i]];
        }

        try {
            l[c[c.length - 1]] = val;
        } catch (e) {
            if (typeof res._weird === 'undefined') res._weird = {};
            res._weird[key] = val;
        }
    }
    return res;
}
