import { ensureTeeSelected } from './ensureTeeSelected.js';

const parseTeeTarget = (value) => {
  if (value === 10 || String(value || '').trim() === '10') {
    return 10;
  }
  return 1;
};

const parseBooleanFlag = (value, fallback = false) => {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return fallback;
};

export async function selectTeeForJob(page, job = {}) {
  const teeTarget = parseTeeTarget(job?.teeTarget ?? job?.tee);
  const fallbackTee = parseBooleanFlag(job?.fallbackTee, false);
  console.log(`[TEE] Selecting tee ${teeTarget}${fallbackTee ? ' (fallback enabled)' : ''}`);
  try {
    await ensureTeeSelected(page, teeTarget);
  } catch (error) {
    console.warn('[TEE] selectTeeForJob failed to ensure tee selected:', error?.message || error);
  }
  return {
    teeTarget,
    fallbackTee,
    altTee: teeTarget === 10 ? 1 : 10,
  };
}

export async function maybeFallbackToAltTee(page, ctx = {}, reason = 'fallback') {
  if (!ctx.fallbackTee) {
    return { didFallback: false };
  }
  try {
    await ensureTeeSelected(page, ctx.altTee);
    console.log(`[TEE] Fallback to tee ${ctx.altTee} (${reason})`);
    return { didFallback: true, teeTarget: ctx.altTee };
  } catch (error) {
    console.warn('[TEE] Fallback tee selection failed:', error?.message || error);
    return { didFallback: false };
  }
}
