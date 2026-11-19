import { getAccount } from '../../lib/data/account';
import { getCurrentFit } from '../../lib/data/fit';
import { sharedRead } from '../../lib/data/refresh';
import { getUser } from '../../lib/data/session';

/*
 * Reads shared by the /app frame and its pages, so opening a page asks the
 * database once for each (see sharedRead).
 */

export const loadUser = sharedRead(getUser);
export const loadAccount = sharedRead(getAccount);
export const loadCurrentFit = sharedRead(getCurrentFit);
