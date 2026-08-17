import 'package:cloud_firestore/cloud_firestore.dart';

enum BookingMode { normal, sniper }

class BookingJob {
  final String? id;
  final String ownerUid;
  final String brsEmail;
  final String brsPassword;
  final String club;
  final String timezone;
  final String releaseDay;
  final String releaseTimeLocal;
  final String targetDay;
  final List<String> preferredTimes;
  final List<String> players;
  final int? partySize;
  final String status;
  final String? state;
  final DateTime? nextFireTimeUtc;
  final String? pushToken;
  final DateTime createdAt;
  final DateTime updatedAt;
  final BookingMode bookingMode;
  // Sniper-specific / extended planning fields
  final DateTime? targetPlayDate; // precise date user wants to play
  final String? targetDate; // date-only key, yyyy-MM-dd, avoids timezone drift
  final DateTime?
      releaseWindowStart; // when tee times are expected to unlock (UTC)
  final Map<String, dynamic>?
      snipeStrategy; // attempt intervals & window sizing
  final String teeMode; // single|both
  final int teeTarget; // 1|10 (primary tee)
  final bool fallbackTee; // when true, allow alternate tee fallback
  final bool proofRun;
  final String? proofLabel;

  BookingJob({
    this.id,
    required this.ownerUid,
    required this.brsEmail,
    required this.brsPassword,
    required this.club,
    required this.timezone,
    required this.releaseDay,
    required this.releaseTimeLocal,
    required this.targetDay,
    required this.preferredTimes,
    required this.players,
    this.partySize,
    this.status = 'active',
    this.state,
    this.nextFireTimeUtc,
    this.pushToken,
    this.bookingMode = BookingMode.normal,
    this.targetPlayDate,
    this.targetDate,
    this.releaseWindowStart,
    this.snipeStrategy,
    this.teeMode = 'single',
    this.teeTarget = 1,
    this.fallbackTee = false,
    this.proofRun = false,
    this.proofLabel,
    DateTime? createdAt,
    DateTime? updatedAt,
  })  : createdAt = createdAt ?? DateTime.now(),
        updatedAt = updatedAt ?? DateTime.now();

  Map<String, dynamic> toJson() => {
        'ownerUid': ownerUid,
        'brs_email': brsEmail,
        'brs_password': brsPassword,
        'club': club,
        'tz': timezone,
        'release_day': releaseDay,
        'release_time_local': releaseTimeLocal,
        'target_day': targetDay,
        'preferred_times': preferredTimes,
        'players': players,
        'party_size': partySize,
        'status': status,
        if (state != null) 'state': state,
        'next_fire_time_utc': nextFireTimeUtc != null
            ? Timestamp.fromDate(nextFireTimeUtc!)
            : null,
        'push_token': pushToken,
        'created_at': Timestamp.fromDate(createdAt),
        'updated_at': Timestamp.fromDate(updatedAt),
        'mode': bookingMode.name,
        'target_date': targetDate,
        'target_play_date':
            targetPlayDate != null ? Timestamp.fromDate(targetPlayDate!) : null,
        'release_window_start': releaseWindowStart != null
            ? Timestamp.fromDate(releaseWindowStart!)
            : null,
        'snipe_strategy': snipeStrategy,
        'tee': teeTarget,
        'tee_mode': teeMode,
        'tee_target': teeTarget,
        'fallback_tee': fallbackTee,
        'proof_run': proofRun,
        if (proofLabel != null) 'proof_label': proofLabel,
      };

  factory BookingJob.fromJson(Map<String, dynamic> json, String id) {
    final hasTeeFields =
        json.containsKey('tee_mode') || json.containsKey('tee_target');
    final parsedTeeMode =
        _parseTeeMode(json['tee_mode'] ?? json['teeMode'] ?? 'single');
    final parsedTeeTarget = _parseTeeTarget(
      json['tee_target'] ?? json['teeTarget'] ?? json['tee'] ?? 1,
    );
    final parsedFallback = _parseBool(
      json['fallback_tee'] ?? json['fallbackTee'] ?? false,
    );

    if (!hasTeeFields) {
      print(
        '⚠️ [BookingJob.fromJson] Missing tee fields for job $id. Defaulting to tee_mode=single, tee_target=1, fallback_tee=false',
      );
    }

    return BookingJob(
      id: id,
      ownerUid: json['ownerUid'] ?? '',
      brsEmail: json['brs_email'] ?? '',
      brsPassword: json['brs_password'] ?? '',
      club: json['club'] ?? '',
      timezone: json['tz'] ?? 'Europe/London',
      releaseDay: json['release_day'] ?? '',
      releaseTimeLocal: json['release_time_local'] ?? '',
      targetDay: json['target_day'] ?? '',
      preferredTimes: List<String>.from(json['preferred_times'] ?? []),
      players: List<String>.from(json['players'] ?? []),
      partySize: json['party_size'] is int ? json['party_size'] as int : null,
      status: json['status'] ?? 'active',
      state: json['state'] as String?,
      nextFireTimeUtc: json['next_fire_time_utc'] is Timestamp
          ? (json['next_fire_time_utc'] as Timestamp).toDate()
          : null,
      pushToken: json['push_token'],
      createdAt: json['created_at'] is Timestamp
          ? (json['created_at'] as Timestamp).toDate()
          : DateTime.now(),
      updatedAt: json['updated_at'] is Timestamp
          ? (json['updated_at'] as Timestamp).toDate()
          : DateTime.now(),
      bookingMode: _parseMode(json['mode']),
      targetDate: json['target_date'] as String?,
      targetPlayDate: json['target_play_date'] is Timestamp
          ? (json['target_play_date'] as Timestamp).toDate()
          : null,
      releaseWindowStart: json['release_window_start'] is Timestamp
          ? (json['release_window_start'] as Timestamp).toDate()
          : null,
      snipeStrategy: json['snipe_strategy'] is Map<String, dynamic>
          ? Map<String, dynamic>.from(json['snipe_strategy'] as Map)
          : null,
      teeMode: parsedTeeMode,
      teeTarget: parsedTeeTarget,
      fallbackTee: parsedFallback,
      proofRun: _parseBool(json['proof_run'] ?? json['proofRun'] ?? false),
      proofLabel: json['proof_label'] as String?,
    );
  }

  static BookingMode _parseMode(dynamic raw) {
    if (raw is String) {
      switch (raw) {
        case 'sniper':
          return BookingMode.sniper;
        case 'normal':
          return BookingMode.normal;
      }
    }
    return BookingMode.normal;
  }

  static String _parseTeeMode(dynamic raw) {
    final value = raw?.toString().trim().toLowerCase();
    return value == 'both' ? 'both' : 'single';
  }

  static int _parseTeeTarget(dynamic raw) {
    final value = raw?.toString().trim();
    return value == '10' ? 10 : 1;
  }

  static bool _parseBool(dynamic raw) {
    if (raw == true || raw == 'true') return true;
    if (raw == false || raw == 'false') return false;
    return false;
  }

  BookingJob copyWith({
    String? id,
    String? ownerUid,
    String? brsEmail,
    String? brsPassword,
    String? club,
    String? timezone,
    String? releaseDay,
    String? releaseTimeLocal,
    String? targetDay,
    List<String>? preferredTimes,
    List<String>? players,
    int? partySize,
    String? status,
    String? state,
    DateTime? nextFireTimeUtc,
    String? pushToken,
    DateTime? createdAt,
    DateTime? updatedAt,
    BookingMode? bookingMode,
    DateTime? targetPlayDate,
    String? targetDate,
    DateTime? releaseWindowStart,
    Map<String, dynamic>? snipeStrategy,
    String? teeMode,
    int? teeTarget,
    bool? fallbackTee,
    bool? proofRun,
    String? proofLabel,
  }) =>
      BookingJob(
        id: id ?? this.id,
        ownerUid: ownerUid ?? this.ownerUid,
        brsEmail: brsEmail ?? this.brsEmail,
        brsPassword: brsPassword ?? this.brsPassword,
        club: club ?? this.club,
        timezone: timezone ?? this.timezone,
        releaseDay: releaseDay ?? this.releaseDay,
        releaseTimeLocal: releaseTimeLocal ?? this.releaseTimeLocal,
        targetDay: targetDay ?? this.targetDay,
        preferredTimes: preferredTimes ?? this.preferredTimes,
        players: players ?? this.players,
        partySize: partySize ?? this.partySize,
        status: status ?? this.status,
        state: state ?? this.state,
        nextFireTimeUtc: nextFireTimeUtc ?? this.nextFireTimeUtc,
        pushToken: pushToken ?? this.pushToken,
        createdAt: createdAt ?? this.createdAt,
        updatedAt: updatedAt ?? this.updatedAt,
        bookingMode: bookingMode ?? this.bookingMode,
        targetPlayDate: targetPlayDate ?? this.targetPlayDate,
        targetDate: targetDate ?? this.targetDate,
        releaseWindowStart: releaseWindowStart ?? this.releaseWindowStart,
        snipeStrategy: snipeStrategy ?? this.snipeStrategy,
        teeMode: teeMode ?? this.teeMode,
        teeTarget: teeTarget ?? this.teeTarget,
        fallbackTee: fallbackTee ?? this.fallbackTee,
        proofRun: proofRun ?? this.proofRun,
        proofLabel: proofLabel ?? this.proofLabel,
      );
}
