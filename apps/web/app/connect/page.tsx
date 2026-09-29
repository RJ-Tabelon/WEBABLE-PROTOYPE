import { redirect } from 'next/navigation';
import { connection } from 'next/server';

import { ConnectFlow } from '../../components/app/connect/ConnectFlow';
import { signInPath } from '../../lib/auth/routes';
import { getPublicEnv } from '../../lib/env';
import { getCurrentFit } from '../../lib/data/fit';
import { getUser } from '../../lib/data/session';

/** The Chrome Web Store listing for an extension id. */
function storeUrlFor(extensionId: string | null): string | null {
  return extensionId
    ? `https://chromewebstore.google.com/detail/${extensionId}`
    : null;
}

function configuredExtensionId(): string | null {
  try {
    return getPublicEnv().extensionId;
  } catch {
    return null;
  }
}

/**
 * /connect: add the extension and connect this browser to the account. The
 * extension's state is read in the browser (over the bridge); the server only
 * knows who is signed in and whether they have a fit yet.
 */
export default async function ConnectPage() {
  await connection();
  const user = await getUser();
  if (!user) redirect(signInPath('/connect'));
  const fit = await getCurrentFit();
  const development = process.env.NODE_ENV !== 'production';

  return (
    <ConnectFlow
      email={user.email}
      hasFit={fit.ok && fit.data !== null}
      storeUrl={storeUrlFor(configuredExtensionId())}
      showDevSteps={development}
    />
  );
}
