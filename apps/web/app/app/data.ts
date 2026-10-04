import { cache } from 'react';

import { getAccount } from '../../lib/data/account';
import { getCurrentFit } from '../../lib/data/fit';
import { getUser } from '../../lib/data/session';

/*
 * Request-scoped reads shared by the /app layout and its pages. React's cache()
 * dedupes them within one server render, so the layout and the page ask the
 * database once. Server only.
 */

export const loadUser = cache(getUser);
export const loadAccount = cache(getAccount);
export const loadCurrentFit = cache(getCurrentFit);
