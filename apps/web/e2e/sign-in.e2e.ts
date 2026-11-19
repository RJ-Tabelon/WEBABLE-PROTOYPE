import { expect, test } from '@playwright/test';

import { expectPageBasics } from './support/a11y';
import { testUser } from './support/env';

/*
 * Account pages, signed out: structure, plain errors next to the field, the
 * email-link alternative, `next` support, and the protected-route redirect.
 */

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('sign in', () => {
  test('is a calm, accessible form', async ({ page }) => {
    await page.goto('/sign-in');
    await expectPageBasics(page, { h1: 'Sign in', app: false });
    // One row of actions under the fields; the link-by-email explains itself.
    const link = page.getByRole('button', { name: 'Email me a link' });
    await expect(link).toBeVisible();
    await expect(link).toHaveAccessibleDescription(
      'A link signs you in without a password.',
    );
    await expect(
      page.getByRole('link', { name: 'Forgot your password?' }),
    ).toBeVisible();
    // Reading order follows the label row: label, then the link, then the field.
    const forgot = await page
      .getByRole('link', { name: 'Forgot your password?' })
      .boundingBox();
    const label = await page
      .getByText('Password', { exact: true })
      .boundingBox();
    expect(Math.abs((forgot?.y ?? 0) - (label?.y ?? 0))).toBeLessThan(12);
    await expect(page.getByLabel('Email')).toHaveAttribute(
      'autocomplete',
      'email',
    );
    await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute(
      'autocomplete',
      'current-password',
    );
  });

  test('puts plain errors next to each field and keeps what was typed', async ({
    page,
  }) => {
    await page.goto('/sign-in');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    const email = page.getByLabel('Email');
    await expect(email).toHaveAttribute('aria-invalid', 'true');
    await expect(email).toBeFocused();
    await expect(
      page.getByText('Enter an email address like name@example.com.'),
    ).toBeVisible();
    await expect(page.getByText('Enter your password.')).toBeVisible();

    await email.fill('name@example');
    await page.getByLabel('Password', { exact: true }).fill('x');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(email).toHaveValue('name@example');
    await expect(email).toHaveAttribute('aria-invalid', 'true');
  });

  test('says when the email and password do not match', async ({ page }) => {
    const { email } = testUser();
    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(email);
    await page
      .getByLabel('Password', { exact: true })
      .fill('not-the-password-1');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    const alert = page
      .getByRole('alert')
      .filter({ hasText: 'Couldn’t sign in' });
    await expect(alert).toContainText(/That email and password don.t match/);
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test('shows a link error from the callback in plain words', async ({
    page,
  }) => {
    await page.goto('/sign-in?error=link_expired');
    await expect(
      page.getByText('That link has expired or was already used.'),
    ).toBeVisible();
    await page.goto('/sign-in?error=%3Cscript%3E');
    await expect(page.getByText('That link didn’t sign you in')).toHaveCount(0);
  });

  test('sends signed-out visitors to sign in, then back where they were going', async ({
    page,
  }) => {
    const user = testUser();
    await page.goto('/app/privacy');
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fapp%2Fprivacy/);
    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Password', { exact: true }).fill(user.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL('**/app/privacy');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Privacy' }),
    ).toBeVisible();
  });

  test('never redirects off-site from next', async ({ page }) => {
    const user = testUser();
    await page.goto('/sign-in?next=%2F%2Fevil.example%2Fx');
    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Password', { exact: true }).fill(user.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL('**/app');
    expect(page.url()).not.toContain('evil.example');
  });
});

test.describe('other account pages', () => {
  test('sign up offers a password or an email link, nothing pre-ticked', async ({
    page,
  }) => {
    await page.goto('/sign-up');
    await expectPageBasics(page, { h1: 'Create your account', app: false });
    await expect(
      page.getByRole('button', { name: 'Email me a link instead' }),
    ).toBeVisible();
    await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(0);
    await page.getByLabel('Choose a password').fill('short');
    await page.getByLabel('Email').fill('someone@example.com');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(
      page.getByText(/Use a password with at least \d+ characters\./),
    ).toBeVisible();
  });

  test('forgot password asks for an email', async ({ page }) => {
    await page.goto('/forgot-password');
    await expectPageBasics(page, { h1: 'Reset your password', app: false });
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(
      page.getByText('Enter an email address like name@example.com.'),
    ).toBeVisible();
  });

  test('reset password without a session explains the link has expired', async ({
    page,
  }) => {
    await page.goto('/reset-password');
    await expectPageBasics(page, { h1: 'This link has expired', app: false });
    await expect(
      page.getByRole('link', { name: 'Ask for a new link' }),
    ).toBeVisible();
  });

  test('check your email never puts the address in the URL', async ({
    page,
  }) => {
    await page.goto('/check-email?kind=reset');
    await expectPageBasics(page, { h1: 'Check your email', app: false });
    await expect(page.getByText(/your email address/)).toBeVisible();
  });

  test('check your email keeps where you were going', async ({ page }) => {
    await page.goto('/check-email?kind=sign-up&next=%2Fconnect');
    await expect(
      page.getByText(/Open it on this computer so your fit can be saved\./),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Use a different email' }),
    ).toHaveAttribute('href', '/sign-up?next=%2Fconnect');
  });
});
