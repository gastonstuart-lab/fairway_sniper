import 'package:fairway_sniper/models/booking_job.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('sniper draft job serializes paused status and tee fields', () {
    final job = BookingJob(
      ownerUid: 'user-1',
      brsEmail: 'stuart@example.com',
      brsPassword: 'secret',
      club: 'galgorm',
      timezone: 'Europe/London',
      releaseDay: 'Friday',
      releaseTimeLocal: '19:20',
      targetDay: 'Wednesday',
      preferredTimes: const ['11:04', '11:12', '11:20'],
      players: const ['player-2', 'player-3', 'player-4'],
      partySize: 4,
      bookingMode: BookingMode.sniper,
      targetDate: '2026-07-01',
      teeMode: 'single',
      teeTarget: 10,
      fallbackTee: false,
      status: 'paused',
      state: 'paused',
    );

    final json = job.toJson();

    expect(json['mode'], 'sniper');
    expect(json['status'], 'paused');
    expect(json['state'], 'paused');
    expect(json['target_date'], '2026-07-01');
    expect(json['preferred_times'], ['11:04', '11:12', '11:20']);
    expect(json['party_size'], 4);
    expect(json['players'], ['player-2', 'player-3', 'player-4']);
    expect(json['tee'], 10);
    expect(json['tee_mode'], 'single');
    expect(json['tee_target'], 10);
    expect(json['fallback_tee'], false);
  });

  test('booking job parses paused state and tee fields from Firestore data',
      () {
    final job = BookingJob.fromJson(
      {
        'ownerUid': 'user-1',
        'brs_email': 'stuart@example.com',
        'brs_password': 'secret',
        'club': 'galgorm',
        'tz': 'Europe/London',
        'release_day': 'Friday',
        'release_time_local': '19:20',
        'target_day': 'Wednesday',
        'preferred_times': ['11:04', '11:12'],
        'players': ['player-2'],
        'party_size': 2,
        'mode': 'sniper',
        'status': 'paused',
        'state': 'paused',
        'target_date': '2026-07-01',
        'tee': 10,
        'tee_mode': 'single',
        'tee_target': 10,
        'fallback_tee': false,
      },
      'job-1',
    );

    expect(job.bookingMode, BookingMode.sniper);
    expect(job.status, 'paused');
    expect(job.state, 'paused');
    expect(job.teeTarget, 10);
    expect(job.fallbackTee, false);
  });
}
