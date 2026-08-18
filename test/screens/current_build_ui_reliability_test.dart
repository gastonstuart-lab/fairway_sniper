import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('booking wizards launch under a readable dark theme', () {
    final source =
        File('lib/screens/mode_selection_screen.dart').readAsStringSync();
    expect(source, contains("import 'package:fairway_sniper/theme.dart';"));
    expect(source, contains('data: darkTheme'));
    expect(source, contains('child: const NewJobWizard()'));
    expect(source, contains('child: const SniperJobWizard()'));
  });
}
