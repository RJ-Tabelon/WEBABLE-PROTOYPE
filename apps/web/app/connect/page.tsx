import { ConnectView } from './ConnectView';

/**
 * /connect: add the extension and connect this browser to the account. The
 * extension's state is read over the bridge, and who is signed in and whether
 * they have a fit yet come from Supabase, all in the browser.
 */
export default function ConnectPage() {
  return <ConnectView />;
}
