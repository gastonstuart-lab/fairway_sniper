import 'package:flutter_test/flutter_test.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:fairway_sniper/models/booking_job.dart';
import 'package:fairway_sniper/services/safe_proof_builder.dart';

BookingJob sniperJob({
  String id = 'real-job',
  DateTime? createdAt,
  bool proof = false,
  int partySize = 4,
  List<String> players = const ['101', '202', '303'],
}) {
  return BookingJob(
    id: id,
    ownerUid: 'stuart',
    brsEmail: '',
    brsPassword: '',
    club: 'galgorm',
    timezone: 'Europe/London',
    releaseDay: 'Saturday',
    releaseTimeLocal: '19:20',
    targetDay: 'Saturday',
    targetDate: '2026-08-22',
    targetPlayDate: DateTime.utc(2026, 8, 22),
    preferredTimes: const ['11:12'],
    players: players,
    partySize: partySize,
    bookingMode: BookingMode.sniper,
    teeMode: 'single',
    teeTarget: 1,
    fallbackTee: false,
    proofRun: proof,
    proofLabel: proof ? 'safe_production_proof' : null,
    createdAt: createdAt ?? DateTime.utc(2026, 8, 17, 20),
  );
}

void main() {
  test('four-player real sniper template creates four-player proof payload',
      () {
    final payload = buildSafeProofPayload(
      ownerUid: 'stuart',
      template: sniperJob(),
      nowUtc: DateTime.utc(2026, 8, 17, 20),
      prepLead: const Duration(minutes: 4),
      candidate:
          const SafeProofCandidate(date: '2026-08-22', time: '11:12', tee: 1),
    );

    expect(payload['party_size'], 4);
    expect(payload['players'], ['101', '202', '303']);
    expect(payload['proof_template_job_id'], 'real-job');
    expect(payload['proof_candidate_date'], '2026-08-22');
    expect(payload['proof_candidate_time'], '11:12');
    expect(payload['proof_party_size'], 4);
    expect(payload['proof_run'], true);
    expect(payload['dry_run'], true);
  });

  test('previous proof jobs are excluded from template selection', () {
    final olderReal =
        sniperJob(id: 'real', createdAt: DateTime.utc(2026, 8, 17, 19));
    final newerProof = sniperJob(
      id: 'proof',
      proof: true,
      createdAt: DateTime.utc(2026, 8, 17, 20),
    );

    expect(selectSafeProofTemplate([newerProof, olderReal])?.id, 'real');
  });

  test('safe proof fire delay puts PREP in the future', () {
    final delay = proofFireDelay(const Duration(minutes: 4));
    expect(delay, const Duration(minutes: 5, seconds: 30));

    final payload = buildSafeProofPayload(
      ownerUid: 'stuart',
      template: sniperJob(),
      nowUtc: DateTime.utc(2026, 8, 17, 20),
      prepLead: const Duration(minutes: 4),
    );
    final fire = payload['proof_fire_time_override_utc'] as Timestamp;
    expect(
      fire.toDate().difference(DateTime.utc(2026, 8, 17, 20)),
      const Duration(minutes: 5, seconds: 30),
    );
  });

  test('malformed four-player proof template fails instead of downgrading', () {
    expect(
      () => buildSafeProofPayload(
        ownerUid: 'stuart',
        template: sniperJob(players: const ['101'], partySize: 4),
        nowUtc: DateTime.utc(2026, 8, 17, 20),
        prepLead: const Duration(minutes: 4),
      ),
      throwsStateError,
    );
  });
}
