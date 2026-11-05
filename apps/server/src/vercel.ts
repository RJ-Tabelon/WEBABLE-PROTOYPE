// Vercel entry: the same routes as index.ts, as one Node function (scripts/build-vercel.mjs bundles it into
// .vercel/output). No listen, no keep-warm timer and no boot probe: an instance only lives while it is answering.
// WEBABLE_PUBLIC=1 (set on the Vercel project) turns on the public guards in guard.ts.
import { getRequestListener } from '@hono/node-server';
import { createApp } from './app';
import { registerAttribute } from './routes/attribute';
import { registerMeaning } from './routes/meaning';

const app = createApp();
registerAttribute(app);
registerMeaning(app);

export default getRequestListener(app.fetch);
