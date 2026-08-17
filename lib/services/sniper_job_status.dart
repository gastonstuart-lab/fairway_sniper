import 'package:fairway_sniper/models/booking_job.dart';

String sniperLifecycleLabel(BookingJob job) {
  final state = (job.state ?? '').trim().toLowerCase();
  final status = job.status.trim().toLowerCase();
  final hasProductionSchedule =
      job.prepScheduledFor != null && job.scheduledFor != null;

  switch (state) {
    case 'paused':
      return 'Paused';
    case 'queued':
      return 'Arming Sniper…';
    case 'production_confirmed':
      return hasProductionSchedule ? 'Sniper Scheduled' : 'Arming Sniper…';
    case 'timer_registered':
    case 'waiting_for_prep':
      return 'Waiting for PREP';
    case 'warming':
      return 'Warming BRS';
    case 'ready':
      return 'Ready — Waiting for FIRE';
    case 'waiting_for_fire':
      return 'Waiting for FIRE';
    case 'firing':
      return 'Firing';
    case 'booking':
      return 'Booking…';
    case 'running':
      return hasProductionSchedule ? 'Sniper Scheduled' : 'Arming Sniper…';
    case 'finished':
      return 'Booked';
    case 'error':
      return 'Failed / Needs Attention';
  }

  if (status == 'error') return 'Failed / Needs Attention';
  if (status == 'finished') return 'Booked';
  if (status == 'running') {
    return hasProductionSchedule ? 'Sniper Scheduled' : 'Arming Sniper…';
  }
  if (status == 'active') return 'Arming Sniper…';
  return status.isEmpty ? 'Unknown' : status.toUpperCase();
}

bool isLiveSniperJob(BookingJob job) {
  if (job.bookingMode != BookingMode.sniper || job.proofRun) return false;
  final state = (job.state ?? '').trim().toLowerCase();
  final status = job.status.trim().toLowerCase();
  if (state == 'paused' || state == 'error' || state == 'finished') return false;
  if (status == 'error' || status == 'finished') return false;
  return status == 'active' || status == 'running' ||
      const {
        'queued',
        'production_confirmed',
        'timer_registered',
        'waiting_for_prep',
        'warming',
        'ready',
        'waiting_for_fire',
        'firing',
        'booking',
        'running',
      }.contains(state);
}

bool isProductionScheduledSniper(BookingJob job) {
  if (!isLiveSniperJob(job)) return false;
  final state = (job.state ?? '').trim().toLowerCase();
  const productionStates = {
    'production_confirmed',
    'timer_registered',
    'waiting_for_prep',
    'warming',
    'ready',
    'waiting_for_fire',
    'firing',
    'booking',
    'running',
  };
  return productionStates.contains(state) &&
      job.prepScheduledFor != null &&
      job.scheduledFor != null;
}
