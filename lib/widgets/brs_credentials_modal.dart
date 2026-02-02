import 'package:flutter/material.dart';

/// Reusable modal for editing BRS Golf credentials
/// Used by: mode_selection_screen, dashboard_screen, new_job_wizard, sniper_job_wizard
Future<Map<String, String>?> showBRSCredentialsModal(
  BuildContext context, {
  String? initialUsername,
  String? initialPassword,
  String title = 'Edit BRS Login',
  String usernameLabel = 'BRS Username',
  String passwordLabel = 'BRS Password',
}) async {
  final usernameController =
      TextEditingController(text: initialUsername ?? '');
  final passwordController =
      TextEditingController(text: initialPassword ?? '');

  final result = await showDialog<bool>(
    context: context,
    builder: (context) {
      return AlertDialog(
        title: Text(title),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: usernameController,
              decoration: InputDecoration(
                labelText: usernameLabel,
                prefixIcon: const Icon(Icons.person_outline),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: passwordController,
              obscureText: true,
              decoration: InputDecoration(
                labelText: passwordLabel,
                prefixIcon: const Icon(Icons.lock_outline),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Save'),
          ),
        ],
      );
    },
  );

  if (result == true) {
    final username = usernameController.text.trim();
    final password = passwordController.text;
    if (username.isNotEmpty && password.isNotEmpty) {
      usernameController.dispose();
      passwordController.dispose();
      return {'username': username, 'password': password};
    }
  }

  usernameController.dispose();
  passwordController.dispose();
  return null;
}
