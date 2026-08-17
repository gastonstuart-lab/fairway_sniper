import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('sniper wizard schedules real jobs instead of saving paused drafts', () {
    final source =
        File('lib/screens/sniper_job_wizard.dart').readAsStringSync();
    expect(source, contains("status: 'active'"));
    expect(source, contains("state: 'queued'"));
    expect(source, contains("'Schedule Sniper'"));
    expect(source, contains('popUntil((route) => route.isFirst)'));
    expect(source, isNot(contains('Job saved as draft / paused')));
  });
}
