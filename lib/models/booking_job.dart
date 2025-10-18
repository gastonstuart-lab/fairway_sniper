import 'package:cloud_firestore/cloud_firestore.dart';

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
  final String status;
  final DateTime? nextFireTimeUtc;
  final String? pushToken;
  final DateTime createdAt;
  final DateTime updatedAt;

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
    this.status = 'active',
    this.nextFireTimeUtc,
    this.pushToken,
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
        'status': status,
        'next_fire_time_utc': nextFireTimeUtc != null ? Timestamp.fromDate(nextFireTimeUtc!) : null,
        'push_token': pushToken,
        'created_at': Timestamp.fromDate(createdAt),
        'updated_at': Timestamp.fromDate(updatedAt),
      };

  factory BookingJob.fromJson(Map<String, dynamic> json, String id) => BookingJob(
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
        status: json['status'] ?? 'active',
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
      );

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
    String? status,
    DateTime? nextFireTimeUtc,
    String? pushToken,
    DateTime? createdAt,
    DateTime? updatedAt,
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
        status: status ?? this.status,
        nextFireTimeUtc: nextFireTimeUtc ?? this.nextFireTimeUtc,
        pushToken: pushToken ?? this.pushToken,
        createdAt: createdAt ?? this.createdAt,
        updatedAt: updatedAt ?? this.updatedAt,
      );
}
