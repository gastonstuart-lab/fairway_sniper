import 'package:cloud_firestore/cloud_firestore.dart';

class BookingRun {
  final String? id;
  final String jobId;
  final String ownerUid;
  final DateTime startedUtc;
  final DateTime? finishedUtc;
  final String result;
  final String notes;
  final int latencyMs;
  final String? chosenTime;
  final int fallbackLevel;

  BookingRun({
    this.id,
    required this.jobId,
    required this.ownerUid,
    required this.startedUtc,
    this.finishedUtc,
    this.result = 'pending',
    this.notes = '',
    this.latencyMs = 0,
    this.chosenTime,
    this.fallbackLevel = 0,
  });

  Map<String, dynamic> toJson() => {
        'jobId': jobId,
        'ownerUid': ownerUid,
        'started_utc': Timestamp.fromDate(startedUtc),
        'finished_utc': finishedUtc != null ? Timestamp.fromDate(finishedUtc!) : null,
        'result': result,
        'notes': notes,
        'latency_ms': latencyMs,
        'chosen_time': chosenTime,
        'fallback_level': fallbackLevel,
      };

  factory BookingRun.fromJson(Map<String, dynamic> json, String id) => BookingRun(
        id: id,
        jobId: json['jobId'] ?? '',
        ownerUid: json['ownerUid'] ?? '',
        startedUtc: json['started_utc'] is Timestamp
            ? (json['started_utc'] as Timestamp).toDate()
            : DateTime.now(),
        finishedUtc: json['finished_utc'] is Timestamp
            ? (json['finished_utc'] as Timestamp).toDate()
            : null,
        result: json['result'] ?? 'pending',
        notes: json['notes'] ?? '',
        latencyMs: json['latency_ms'] ?? 0,
        chosenTime: json['chosen_time'],
        fallbackLevel: json['fallback_level'] ?? 0,
      );

  BookingRun copyWith({
    String? id,
    String? jobId,
    String? ownerUid,
    DateTime? startedUtc,
    DateTime? finishedUtc,
    String? result,
    String? notes,
    int? latencyMs,
    String? chosenTime,
    int? fallbackLevel,
  }) =>
      BookingRun(
        id: id ?? this.id,
        jobId: jobId ?? this.jobId,
        ownerUid: ownerUid ?? this.ownerUid,
        startedUtc: startedUtc ?? this.startedUtc,
        finishedUtc: finishedUtc ?? this.finishedUtc,
        result: result ?? this.result,
        notes: notes ?? this.notes,
        latencyMs: latencyMs ?? this.latencyMs,
        chosenTime: chosenTime ?? this.chosenTime,
        fallbackLevel: fallbackLevel ?? this.fallbackLevel,
      );
}
