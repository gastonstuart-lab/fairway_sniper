export const DRY_RUN_PREBOOK_REACHED = 'DRY_RUN_PREBOOK_REACHED';

export const BOOKING_FORM_SELECTOR = 'form[name="member_booking_form"]';

export const CONFIRM_CONTROL_SELECTOR = [
  'button#member_booking_form_confirm_booking',
  'input#member_booking_form_confirm_booking',
  'form[name="member_booking_form"] button[type="submit"]',
  'form[name="member_booking_form"] input[type="submit"]',
].join(', ');

function normalizeOpenSlots(openSlots) {
  return Number.isFinite(Number(openSlots)) ? Math.max(0, Number(openSlots)) : 3;
}

function requestedPlayersForCapacity(players = [], openSlots = 3) {
  return Array.isArray(players)
    ? players.slice(0, Math.min(normalizeOpenSlots(openSlots), 3))
    : [];
}

function boundaryError(evidence) {
  if (!evidence.capacityValidated) return 'insufficient-capacity';
  if (!evidence.bookingFormVisible) return 'booking-form-not-found';
  if (!evidence.playersFilledOk) return 'players-missing-before-confirm';
  if (!evidence.confirmControlVisible) return 'confirm-control-not-found';
  if (!evidence.confirmControlEnabled) return 'confirm-control-disabled';
  return null;
}

function playerDiagnosticsOk(fieldDiagnostics = []) {
  return fieldDiagnostics.every((diag) => {
    if (!diag || diag.selectedRequestedValue === undefined) return true;
    return diag.selectedRequestedValue === true;
  });
}

export function buildPrebookBoundaryEvidence({
  bookingFormVisible = false,
  confirmControlVisible = false,
  confirmControlEnabled = false,
  playersExpected = [],
  playersFilled = [],
  capacityValidated = false,
  verificationUrl = null,
  candidateTime = null,
  teeSelected = null,
  fieldDiagnostics = [],
  skippedReason = null,
  confirmControlText = null,
} = {}) {
  const expected = Array.isArray(playersExpected) ? playersExpected : [];
  const filled = Array.isArray(playersFilled) ? playersFilled : [];
  const playersFilledOk =
    filled.length >= expected.length && playerDiagnosticsOk(fieldDiagnostics);
  const evidence = {
    prebookBoundaryReached: false,
    bookingFormVisible: Boolean(bookingFormVisible),
    confirmControlVisible: Boolean(confirmControlVisible),
    confirmControlEnabled: Boolean(confirmControlEnabled),
    finalControlNotClicked: true,
    playersExpected: expected,
    playersFilled: filled,
    playersFilledOk,
    capacityValidated: Boolean(capacityValidated),
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
    openSlots = 3,
    confirmResult = {},
    candidateTime = null,
    teeSelected = null,
    capacityValidated = null,
  } = {},
) {
  const normalizedOpenSlots = normalizeOpenSlots(openSlots);
  const playersExpected = requestedPlayersForCapacity(players, normalizedOpenSlots);
  const computedCapacityValidated =
    capacityValidated === null || capacityValidated === undefined
      ? (Array.isArray(players) ? players.length : 0) <= normalizedOpenSlots
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
    verificationUrl: page.url(),
    candidateTime,
    teeSelected,
    fieldDiagnostics: confirmResult.fieldDiagnostics || [],
    skippedReason: confirmResult.skippedReason || null,
  });
}
