/*
 * The writes Client Components use (the Tune flow, settings toggles, Connect).
 * Each is a thin wrapper: the lib/data function it calls validates input,
 * verifies the session, and returns a DataResult. They run in the browser and
 * talk to Supabase directly.
 */

import {
  type AccountPatch,
  advanceOnboarding,
  type OnboardingStep,
  updateAccount,
} from './account';
import {
  abandonCalibrationSession,
  type CompleteCalibrationInput,
  completeCalibrationSession,
  type StartCalibrationInput,
  startCalibrationSession,
} from './calibration';
import { requestExtensionLink } from './extension';
import { type SaveFitInput, saveFit } from './fit';
import { removeInstall } from './installs';
import { deleteMyAccount, exportMyData } from './privacy';

export async function startCalibrationSessionAction(
  input: StartCalibrationInput,
) {
  return startCalibrationSession(input);
}

export async function completeCalibrationSessionAction(
  input: CompleteCalibrationInput,
) {
  return completeCalibrationSession(input);
}

export async function abandonCalibrationSessionAction(input: { id: string }) {
  return abandonCalibrationSession(input);
}

export async function saveFitAction(input: SaveFitInput) {
  return saveFit(input);
}

export async function updateAccountAction(patch: AccountPatch) {
  return updateAccount(patch);
}

export async function advanceOnboardingAction(step: OnboardingStep) {
  return advanceOnboarding(step);
}

export async function removeInstallAction(input: { id: string }) {
  return removeInstall(input);
}

export async function exportMyDataAction() {
  return exportMyData();
}

export async function deleteMyAccountAction() {
  return deleteMyAccount();
}

/** Returns the single-use token hash for the extension handoff (see lib/data/extension.ts). */
export async function requestExtensionLinkAction() {
  return requestExtensionLink();
}
