/// Unified spacing scale for Fairway Sniper app
/// Ensures consistent padding, margins, and gaps across all screens
class AppSpacing {
  // Base spacing units
  static const double xs = 4.0;      // For tight spacing (dividers, small gaps)
  static const double sm = 8.0;      // For compact spacing (icon-text gaps)
  static const double md = 12.0;     // For normal spacing (element groups)
  static const double lg = 16.0;     // For comfortable spacing (card padding)
  static const double xl = 24.0;     // For section spacing (major sections)
  static const double xxl = 32.0;    // For page-level spacing (columns, headers)
  
  // Common composite spacing values
  static const double cardPadding = lg;
  static const double buttonHeight = 56.0;
  static const double buttonPadding = lg;
  static const double buttonSpacing = md;
  static const double appBarHeight = 64.0;
  static const double inputFieldHeight = 56.0;
  
  // Responsive spacing
  static const double mobileMaxWidth = 450.0;
  static const double tabletMaxWidth = 800.0;
  static const double desktopMaxWidth = 1000.0;
}

/// Border radius standards for consistency
class AppBorderRadius {
  static const double sm = 8.0;      // For small components (buttons, chips)
  static const double md = 12.0;     // For standard components (cards, dialogs)
  static const double lg = 16.0;     // For larger components (modals, containers)
  static const double xl = 20.0;     // For large cards with elevated status
  static const double circle = 50.0; // For circular components (avatars)
}

/// Elevation values for Material Design consistency
class AppElevation {
  static const double none = 0.0;
  static const double subtle = 2.0;   // Slight elevation (subtle cards)
  static const double standard = 4.0; // Default elevation (cards)
  static const double elevated = 8.0; // Elevated status (FAB, modal)
  static const double high = 16.0;    // High elevation (modal dialogs)
}
