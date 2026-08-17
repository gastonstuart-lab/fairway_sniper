import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:intl/intl.dart';
import 'package:fairway_sniper/models/booking_job.dart';

class SafeProofCandidate {
  const SafeProofCandidate({
    required this.date,
    required this.time,
    required this.tee,
  });

  final String date;
  final String time;
  final int tee;
}

bool isProofJob(BookingJob job) =>
    job.proofRun || job.proofLabel == 'safe_production_proof';

BookingJob? selectSafeProofTemplate(List<BookingJob> jobs) {
  final candidates = jobs
      .where((job) => job.bookingMode == BookingMode.sniper)
      .where((job) => !isProofJob(job))
      .where((job) => (job.partySize ?? job.players.length + 1) >= 1)
      .toList()
    ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
  return candidates.isEmpty ? null : candidates.first;
}

Duration proofFireDelay(Duration prepLead) {
  final safeLead = prepLead.isNegative ? Duration.zero : prepLead;
  return safeLead + const Duration(seconds: 90);
}

Map<String, dynamic> buildSafeProofPayload({
  required String ownerUid,
  required BookingJob template,
  required DateTime nowUtc,
  required Duration prepLead,
  SafeProofCandidate? candidate,
}) {
  final partySize = template.partySize ?? template.players.length + 1;
  if (partySize < 1 || partySize > 4) {
    throw StateError('invalid-party-size');
  }
  if (template.players.length != partySize - 1) {
    throw StateError('party-player-count-mismatch');
  }

  final proofCandidate = candidate ??
      SafeProofCandidate(
        date: template.targetDate ??
            DateFormat('yyyy-MM-dd').format(
              template.targetPlayDate ?? nowUtc.add(const Duration(days: 1)),
            ),
        time: template.preferredTimes.isNotEmpty
            ? template.preferredTimes.first
            : '11:12',
        tee: template.teeTarget,
      );
  final targetDateParts =
      proofCandidate.date.split('-').map(int.parse).toList();
  final targetPlayDateUtc = DateTime.utc(
    targetDateParts[0],
    targetDateParts[1],
    targetDateParts[2],
  );
  final fireOverrideUtc = nowUtc.add(proofFireDelay(prepLead));

  return <String, dynamic>{
    'ownerUid': ownerUid,
    'mode': 'sniper',
    'status': 'active',
    'state': 'queued',
    'club': template.club,
    'tz': template.timezone,
    'release_day': DateFormat('EEEE').format(targetPlayDateUtc),
    'release_time_local': template.releaseTimeLocal,
    'target_day': DateFormat('EEEE').format(targetPlayDateUtc),
    'target_date': proofCandidate.date,
    'target_play_date': Timestamp.fromDate(targetPlayDateUtc),
    'preferred_times': <String>[proofCandidate.time],
    'players': List<String>.from(template.players),
    'party_size': partySize,
    'tee': proofCandidate.tee,
    'tee_target': proofCandidate.tee,
    'tee_mode': template.teeMode,
    'fallback_tee': template.fallbackTee,
    'dry_run': true,
    'proof_run': true,
    'proof_label': 'safe_production_proof',
    'proof_template_job_id': template.id,
    'proof_candidate_date': proofCandidate.date,
    'proof_candidate_time': proofCandidate.time,
    'proof_candidate_tee': proofCandidate.tee,
    'proof_party_size': partySize,
    'proof_fire_delay_ms': proofFireDelay(prepLead).inMilliseconds,
    'proof_fire_time_override_utc': Timestamp.fromDate(fireOverrideUtc),
    'created_at': FieldValue.serverTimestamp(),
    'updated_at': FieldValue.serverTimestamp(),
  };
}
