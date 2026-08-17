import 'package:flutter_test/flutter_test.dart';
import 'package:fairway_sniper/models/booking_job.dart';
import 'package:fairway_sniper/services/sniper_job_status.dart';

BookingJob sniperJob({
  String status = 'active',
  String? state = 'queued',
  bool productionTimes = false,
}) {
  final fire = DateTime.utc(2026, 8, 18, 18, 20);
  return BookingJob(
    ownerUid: 'owner',
    brsEmail: '',
    brsPassword: '',
    club: 'galgorm',
    timezone: 'Europe/London',
    releaseDay: 'Tuesday',
    releaseTimeLocal: '19:20',
    targetDay: 'Saturday',
    preferredTimes: const ['11:12'],
    players: const ['16524', '14481', '730'],
    partySize: 4,
    bookingMode: BookingMode.sniper,
    status: status,
    state: state,
    scheduledFor: productionTimes ? fire : null,
    prepScheduledFor:
        productionTimes ? fire.subtract(const Duration(minutes: 4)) : null,
  );
}

void main() {
  test('queued sniper is arming, not falsely scheduled', () {
    final job = sniperJob();
    expect(sniperLifecycleLabel(job), 'Arming Sniper…');
    expect(isProductionScheduledSniper(job), isFalse);
    expect(isLiveSniperJob(job), isTrue);
  });

  test('production confirmed without both timestamps still says arming', () {
    final job = sniperJob(status: 'running', state: 'production_confirmed');
    expect(sniperLifecycleLabel(job), 'Arming Sniper…');
    expect(isProductionScheduledSniper(job), isFalse);
  });

  test('production confirmed with both timestamps is scheduled', () {
    final job = sniperJob(
      status: 'running',
      state: 'production_confirmed',
      productionTimes: true,
    );
    expect(sniperLifecycleLabel(job), 'Sniper Scheduled');
    expect(isProductionScheduledSniper(job), isTrue);
    expect(isLiveSniperJob(job), isTrue);
  });

  test('running claim remains arming until production timestamps exist', () {
    expect(
      sniperLifecycleLabel(sniperJob(status: 'running', state: 'running')),
      'Arming Sniper…',
    );
    expect(
      sniperLifecycleLabel(sniperJob(
        status: 'running',
        state: 'running',
        productionTimes: true,
      )),
      'Sniper Scheduled',
    );
  });

  test('warming and ready expose truthful lifecycle labels', () {
    expect(
      sniperLifecycleLabel(sniperJob(status: 'running', state: 'warming')),
      'Warming BRS',
    );
    expect(
      sniperLifecycleLabel(sniperJob(status: 'running', state: 'ready')),
      'Ready — Waiting for FIRE',
    );
  });

  test('finished and failed jobs are not live', () {
    final finished = sniperJob(status: 'finished', state: 'finished');
    final failed = sniperJob(status: 'error', state: 'error');
    expect(sniperLifecycleLabel(finished), 'Booked');
    expect(sniperLifecycleLabel(failed), 'Failed / Needs Attention');
    expect(isLiveSniperJob(finished), isFalse);
    expect(isLiveSniperJob(failed), isFalse);
  });

  test('paused legacy sniper remains recoverable but not live', () {
    final job = sniperJob(status: 'paused', state: 'paused');
    expect(sniperLifecycleLabel(job), 'Paused');
    expect(isLiveSniperJob(job), isFalse);
  });
}
