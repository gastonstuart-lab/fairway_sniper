// One-off production-safe proof bootstrap. This module is imported by index.js on
// every production start. The proof job is created only after a settle delay so
// the surviving Railway runner owns it, avoiding the rolling-deploy claim race.
// Remove this import after proof evidence is captured.
import './delayed-safe-proof-v4.mjs';

export const DRY_RUN_PREBOOK_REACHED = 'DRY_RUN_PREBOOK_REACHED';

export const BOOKING_FORM_SELECTOR = 'form[name="member_booking_form"]';

export const CONFIRM_CONTROL_SELECTOR = [
  'button#member_booking_form_confirm_booking',
  'input#member_booking_form_confirm_booking',
  'form[name="member_booking_form"] button[type="submit"]',
  'form[name="member_booking_form"] input[type="submit"]',
].join(', ');

function normalizeOpenSlots(openSlots) {
  if (openSlots === null || openSlots === undefined || openSlots === '') return null;
  return Number.isFinite(Number(openSlots)) ? Math.max(0, Number(openSlots)) : null;
}

function normalizePartySize(partySize, players = []) {
  if (partySize !== null && partySize !== undefined && partySize !== '' && Number.isFinite(Number(partySize))) {
    return Math.max(1, Math.min(4, Number.parseInt(partySize, 10)));
  }
  return Math.max(1, Math.min(4, (Array.isArray(players) ? players.length : 0) + 1));
}

function requestedPlayersForCapacity(players = []) {
  return Array.isArray(players) ? [...players] : [];
}

function boundaryError(evidence) {
  if (!evidence.partyPlayersValid) return 'players-missing-before-confirm';
  if (evidence.capacityError) return evidence.capacityError;
  if (!evidence.capacityValidated) return 'insufficient-capacity';
  if (!evidence.bookingFormVisible) return 'booking-form-not-found';
  if (!evidence.playersFilledOk) return 'players-missing-before-confirm';
  if (!evidence.confirmControlVisible) return 'confirm-control-not-found';
  if (!evidence.confirmControlEnabled) return 'confirm-control-disabled';
  return null;
}

function verifiedPlayersFromDiagnostics(fieldDiagnostics = []) {
  return fieldDiagnostics
    .filter((diag) => diag?.selectedRequestedValue === true)
    .map((diag) => String(diag.selectedValueAfterSelect ?? diag.requested ?? '').trim())
    .filter(Boolean);
}

function exactPlayersVerified(expected = [], verified = []) {
  if (expected.length !== verified.length) return false;
  return expected.every((player, index) => String(player) === String(verified[index]));
}

export function buildPrebookBoundaryEvidence({
  bookingFormVisible = false,
  confirmControlVisible = false,
  confirmControlEnabled = false,
  playersExpected = [],
  playersFilled = [],
  capacityValidated = false,
  capacityError = null,
  openSlots = null,
  partySize = 1,
  partyPlayersValid = true,
  verificationUrl = null,
  candidateTime = null,
  teeSelected = null,
  fieldDiagnostics = [],
  skippedReason = null,
  confirmControlText = null,
} = {}) {
  const expected = Array.isArray(playersExpected) ? playersExpected : [];
  const filled = Array.isArray(playersFilled) ? playersFilled : [];
  const verified = verifiedPlayersFromDiagnostics(fieldDiagnostics);
  const playersFilledOk = exactPlayersVerified(expected, verified);
  const evidence = {
    prebookBoundaryReached: false,
    bookingFormVisible: Boolean(bookingFormVisible),
    confirmControlVisible: Boolean(confirmControlVisible),
    confirmControlEnabled: Boolean(confirmControlEnabled),
    finalControlNotClicked: true,
    playersExpected: expected,
    playersFilled: filled,
    playersVerified: verified,
    playersFilledOk,
    capacityValidated: Boolean(capacityValidated),
    capacityError,
    openSlots,
    partySize,
    partyPlayersValid: Boolean(partyPlayersValid),
    verificationUrl,
    candidateTime,
    teeSelected,
    fieldDiagnostics,
    skippedReason,
    confirmControlText,
    result: null,
    error: null,
  };

  evidence.error = boundaryError(evidence);
  evidence.prebookBoundaryReached = evidence.error === null;
  evidence.result = evidence.prebookBoundaryReached
    ? DRY_RUN_PREBOOK_REACHED
    : 'DRY_RUN_PREBOOK_FAILED';
  return evidence;
}

export async function inspectConfirmControl(page) {
  const form = page.locator(BOOKING_FORM_SELECTOR).first();
  const formVisible = await form.isVisible({ timeout: 1500 }).catch(() => false);
  if (!formVisible) {
    return { visible: false, enabled: false, text: null };
  }

  const control = form
    .locator(
      'button#member_booking_form_confirm_booking, input#member_booking_form_confirm_booking, button[type="submit"], input[type="submit"]',
    )
    .first();
  const visible = await control.isVisible({ timeout: 1500 }).catch(() => false);
  if (!visible) {
    return { visible: false, enabled: false, text: null };
  }

  const enabled = await control.isEnabled({ timeout: 1000 }).catch(async () => {
    return control
      .evaluate((el) => !el.disabled && el.getAttribute('aria-disabled') !== 'true')
      .catch(() => false);
  });
  const text = await control
    .textContent({ timeout: 1000 })
    .then((value) => (value || '').replace(/\s+/g, ' ').trim())
    .catch(() => null);
  return { visible, enabled: Boolean(enabled), text };
}

export async function validatePrebookBoundary(
  page,
  {
    players = [],
    openSlots = null,
    partySize = null,
    confirmResult = {},
    candidateTime = null,
    teeSelected = null,
    capacityValidated = null,
  } = {},
) {
  const normalizedOpenSlots = normalizeOpenSlots(openSlots);
  const normalizedPartySize = normalizePartySize(partySize, players);
  const playersExpected = requestedPlayersForCapacity(players);
  const partyPlayersValid = playersExpected.length === normalizedPartySize - 1;
  const computedCapacityError =
    normalizedOpenSlots === null && normalizedPartySize > 1
      ? 'capacity-unproven'
      : normalizedOpenSlots !== null && normalizedOpenSlots < normalizedPartySize
        ? 'insufficient-capacity'
        : null;
  const computedCapacityValidated =
    capacityValidated === null || capacityValidated === undefined
      ? computedCapacityError === null
      : Boolean(capacityValidated);

  const bookingFormVisible = await page
    .locator(BOOKING_FORM_SELECTOR)
    .first()
    .isVisible({ timeout: 1500 })
    .catch(() => false);
  const confirmControl = await inspectConfirmControl(page);

  return buildPrebookBoundaryEvidence({
    bookingFormVisible,
    confirmControlVisible: confirmControl.visible,
    confirmControlEnabled: confirmControl.enabled,
    confirmControlText: confirmControl.text,
    playersExpected,
    playersFilled: confirmResult.filled || [],
    capacityValidated: computedCapacityValidated,
    capacityError: computedCapacityError,
    openSlots: normalizedOpenSlots,
    partySize: normalizedPartySize,
    partyPlayersValid,
    verificationUrl: page.url(),
    candidateTime,
    teeSelected,
    fieldDiagnostics: confirmResult.fieldDiagnostics || [],
    skippedReason: confirmResult.skippedReason || null,
  });
}
