import 'package:flutter/material.dart';

/// Unified color palette for Fairway Sniper app
/// Ensures consistency across all 7 screens
class AppColors {
  // Primary brand colors
  static const Color primaryGreen = Color(0xFF2E7D32);
  static const Color primaryGreenLight = Color(0xFF43A047);
  static const Color primaryGreenDark = Color(0xFF1B5E20);
  
  // Accent colors
  static const Color accentGold = Color(0xFFFFC107);
  static const Color accentGoldLight = Color(0xFFFFD700);
  static const Color accentAmber = Color(0xFFFFA000);
  
  // Semantic colors
  static const Color success = Color(0xFF4CAF50);
  static const Color warning = Color(0xFFFFC107);
  static const Color error = Color(0xFFD32F2F);
  static const Color info = Color(0xFF2196F3);
  
  // Neutral colors
  static const Color white = Color(0xFFFFFFFF);
  static const Color lightGrey = Color(0xFFF5F5F5);
  static const Color mediumGrey = Color(0xFF9E9E9E);
  static const Color darkGrey = Color(0xFF616161);
  static const Color black = Color(0xFF000000);
  
  // Semantic shades
  static const Color successLight = Color(0xFFC8E6C9);
  static const Color warningLight = Color(0xFFFFE082);
  static const Color errorLight = Color(0xFFEF9A9A);
  static const Color infoLight = Color(0xFF81D4FA);
  
  // Surface colors
  static const Color surface = white;
  static const Color surfaceVariant = Color(0xFFFAFAFA);
  static const Color errorSurface = Color(0xFFFFEBEE);
  static const Color warningSurface = Color(0xFFFFF8E1);
  static const Color successSurface = Color(0xFFF1F8E9);
  
  /// Get green shade (light, normal, dark) for flexible styling
  static Color getGreenShade({int shade = 500}) {
    switch (shade) {
      case 50:
        return const Color(0xFFF1F8E9);
      case 100:
        return const Color(0xFFDCEDC8);
      case 200:
        return const Color(0xFFC5E1A5);
      case 300:
        return const Color(0xFFAED581);
      case 400:
        return const Color(0xFF9CCC65);
      case 500:
        return primaryGreen;
      case 600:
        return const Color(0xFF2E7D32);
      case 700:
        return const Color(0xFF1B5E20);
      case 800:
        return const Color(0xFF12450A);
      case 900:
        return const Color(0xFF082E00);
      default:
        return primaryGreen;
    }
  }
}
