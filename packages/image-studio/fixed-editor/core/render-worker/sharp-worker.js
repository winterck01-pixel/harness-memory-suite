import { createResourcePolicy } from '../resource-policy/policy.js';
import { createWorker, startWorkerProcess } from './worker.js';
import { createSharpCodec } from './sharp-codec.js';
const policy = createResourcePolicy({ codecProfile: 'sharp-0.34.5' });
const codec = createSharpCodec({ policy });
startWorkerProcess({ handleJob: createWorker({ policy, decode: codec.decode, encode: codec.encode }) });
