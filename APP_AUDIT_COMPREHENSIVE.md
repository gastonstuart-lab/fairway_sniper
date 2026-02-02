# Fairway Sniper App - Comprehensive UI/UX Audit

**Date:** Feb 2, 2026  
**Scope:** All 7 screens + design language + engineering quality

---

## EXECUTIVE SUMMARY

### Current State
The app is **functionally complete** with core booking flows working (verified by recent successful sniper test). However, there are significant issues preventing it from being **production-ready**:

1. **Design Inconsistency**: 5 different visual approaches across 7 screens
2. **Dashboard Complexity**: 2784 lines in single file (architectural debt)
3. **Repeated Code**: Credential modals duplicated in 3+ screens
4. **Missing UX Polish**: Loading states, error messaging, animations inconsistent
5. **Navigation Issues**: Mode selection → wizard flow feels disconnected
6. **State Management**: Mix of setState, StreamBuilder, AnimatedBuilder (no cohesion)

### Quality Score: 5.5/10
- Functionality: 8/10 ✅
- Design Consistency: 4/10 ⚠️
- Code Quality: 5/10 ⚠️
- User Experience: 6/10 ⚠️
- Polish & Animation: 3/10 ❌

---

## SCREEN-BY-SCREEN AUDIT

### 1. **login_screen.dart** (346 lines) ✅ GOOD

**Strengths:**
- Beautiful hero branding ("Big Mal the Fairway Sniper")
- Clear call-to-action (Sign In / Create Account)
- Auto-sign-in with credential caching
- Proper error handling (FirebaseAuthException parsing)
- Responsive design (ConstrainedBox maxWidth: 450)
- Remember-me checkbox defaults to ON (good UX for returning users)

**Issues:**
- ⚠️ Google Fonts import but only Ubuntu used (minor waste)
- ⚠️ Manual shadow decoration (should use Shadow utility)
- ⚠️ No loading state animation (circular progress is bare)

**Design Quality:** 7/10
**Recommendation:** KEEP AS-IS with minor polish

---

### 2. **mode_selection_screen.dart** (395 lines) ⚠️ GOOD BUT INCONSISTENT

**Strengths:**
- Excellent mode card design (clear icons, descriptions, call-to-action)
- Shows saved credentials status upfront
- Responsive grid → column layout
- Helpful info banner ("Welcome back, [name]")
- Edit/clear saved credentials buttons available

**Issues:**
- ⚠️ **DUPLICATE CODE**: Credential modal in dashboard + mode selection + sniper wizard (3x copies!)
- ⚠️ **INCONSISTENT**: Uses `Info outline` icon instead of branded color
- ⚠️ **Missing Polish**: No visual feedback on mode card hover
- ⚠️ **Color Scheme**: Lightens at different opacity levels across screens
- ⚠️ **Spacing**: Bannerwidth calculation is complex (should use themes)

**Design Quality:** 6/10
**Recommendation:** EXTRACT credential modal → shared widget, improve hover states

---

### 3. **dashboard_screen.dart** (2784 lines) 🔴 CRITICAL COMPLEXITY

**Strengths:**
- Rich functionality (jobs, weather, news, profile)
- Real-time streams for job updates
- Beautiful welcome card, prefetch status
- Responsive centered containers

**CRITICAL ISSUES:**
- 🔴 **TOO LARGE**: 2784 lines in single file is unmaintainable
- 🔴 **Mixed Concerns**: UI + Logic + Firebase calls + Weather API + News API all together
- 🔴 **State Management**: Mix of setState, StreamBuilder, AnimatedBuilder (no pattern)
- ⚠️ **Repeated Logic**: `_editSavedCreds()` function duplicated from mode_selection
- ⚠️ **Missing Components**: Weather, news, recent runs should be separate widgets
- ⚠️ **No Error States**: Weather/news failures not handled gracefully
- ⚠️ **Hardcoded Styling**: Colors, spacing duplicated from other screens
- ⚠️ **Theme Inconsistency**: Uses `LightModeColors.lightPrimary` (custom theme?) not exposed

**Code Quality:** 3/10  
**Design Quality:** 5/10  
**Recommendation:** **URGENT REFACTOR** - Extract into 4-5 smaller widgets

---

### 4. **new_job_wizard.dart** (1751 lines) ⚠️ COMPLEX BUT ACCEPTABLE

**Strengths:**
- Comprehensive multi-page wizard (credentials, dates, times, party size, players)
- Live availability fetching from agent
- Real-time player directory search
- Pairing logic for multiple players

**Issues:**
- ⚠️ **LARGE**: 1751 lines could be split into smaller components
- ⚠️ **Code Duplication**: Credential entry repeated from login/mode screens
- ⚠️ **Missing Validation**: Party size / player selection error states unclear
- ⚠️ **State Overload**: 20+ state variables with no clear organization
- ⚠️ **No Draft Auto-Save**: User loses progress if app crashes (UNLIKE sniper wizard)

**Code Quality:** 4/10  
**Design Quality:** 5/10  
**Recommendation:** Add draft auto-save (like sniper wizard), extract pages as widgets

---

### 5. **sniper_job_wizard.dart** (1270 lines) ✅ **JUST REDESIGNED**

**Strengths:**
- ✅ Beautiful 5-page wizard (redesigned this session)
- ✅ Draft auto-save with SharedPreferences
- ✅ Security messaging on credentials page (blue lock icon)
- ✅ Release countdown on date page ("X days until booking opens")
- ✅ Smart fallback window explanation card (amber, educational)
- ✅ Conditional rendering for solo vs. group party
- ✅ Final review card before job save
- ✅ Non-blocking agent health badge (amber not red)

**Minor Issues:**
- Minor: Could extract pages as separate widgets for clarity

**Design Quality:** 8/10  
**Recommendation:** USE AS TEMPLATE for new_job_wizard redesign

---

### 6. **course_info_screen.dart** (491 lines) ✅ GOOD

**Strengths:**
- Beautiful course header with gradient
- Clear scorecard display
- Location info, facilities section
- Responsive design

**Issues:**
- Minor: Not integrated into main flow (dead-end screen)
- Minor: No back navigation context

**Design Quality:** 7/10  
**Recommendation:** KEEP AS-IS, ensure accessible from dashboard

---

### 7. **admin_dashboard.dart** (525 lines) ⚠️ FUNCTIONAL BUT BASIC

**Strengths:**
- Tab-based navigation (All Jobs, Users, Feedback, Agent Control)
- Admin role checking via Firebase
- Job/user list views

**Issues:**
- ⚠️ **No Polish**: Minimal styling, basic tab design
- ⚠️ **Purple Color**: Stands out from rest of app (inconsistent branding)
- ⚠️ **Limited Features**: Admin controls seem incomplete
- ⚠️ **No Real-time Updates**: Might show stale data

**Design Quality:** 4/10  
**Recommendation:** Polish UI to match rest of app, add real-time updates

---

## DESIGN LANGUAGE ANALYSIS

### Color Scheme Issues
| Screen | Primary | Secondary | Warning | Error |
|--------|---------|-----------|---------|-------|
| Login | Green gradient | White | N/A | Red snackbar |
| Mode Selection | Green (icons) | Green.shade50 | N/A | N/A |
| Dashboard | Green (0xFF2E7D32) | Gold (FAB) | Amber | Red |
| Sniper Wizard | Green + Amber | Blue (credentials) | Amber | Red |
| Admin Dashboard | **PURPLE** | N/A | N/A | N/A |
| Course Info | Green gradient | White | N/A | N/A |

**Problem**: Admin dashboard uses PURPLE while entire app is green-themed. **INCONSISTENT**.

### Typography Issues
- **Font Families**: Default, Ubuntu (login), Google Fonts imported but underused
- **Font Sizes**: No consistent scale across screens
- **Font Weights**: Mix of w600, w700, bold, fontWeight inconsistently applied
- **Missing**: Heading hierarchy not followed (h1, h2, h3 not used consistently)

### Spacing & Layout
- **Inconsistent Padding**: Screens use 16, 20, 24, 32 mixed with no pattern
- **Modal Alignment**: Not standardized (AlertDialog vs custom modals)
- **Responsive**: ConstrainedBox(maxWidth: ...) used inconsistently (800, 1000, 450)
- **Shadows**: Mix of elevation and custom BoxShadow

### Component Consistency
- **Cards**: Different border radius (12, 16, 20) and elevation levels
- **Buttons**: Mix of FilledButton, ElevatedButton, TextButton, IconButton
- **Icons**: No consistent size standard (varies 16-64)
- **Form Fields**: InputDecoration style varies across screens

---

## ENGINEERING ISSUES

### 1. **Code Duplication** 🔴 CRITICAL
- Credential modal: 3 copies (login_screen, mode_selection, dashboard, sniper_wizard)
- Should be extracted to `widgets/brs_credentials_modal.dart`

### 2. **State Management Confusion** 🔴
- Dashboard: Mix of setState, StreamBuilder, AnimatedBuilder
- New Job Wizard: 20+ state variables in one class
- Sniper Wizard: Better organized but still large
- **Need**: Consistent pattern (Provider? Riverpod? At minimum, better organization)

### 3. **Missing Shared Widgets** 🔴
- Weather card
- News feed item
- Recent runs item
- These should be extracted from dashboard

### 4. **Error Handling Gaps** ⚠️
- Weather fetch failure: No user feedback
- News fetch failure: No user feedback
- Agent health check: Silent failure in new_job_wizard
- Missing: Retry buttons, helpful error messages

### 5. **No Data Validation** ⚠️
- Party size selection: No bounds checking
- Player names: No duplicate detection
- BRS credentials: No format validation before sending to agent

### 6. **Async/Await Issues** ⚠️
- Multiple `if (!mounted) return;` checks (verbose, repetitive)
- Some StreamBuilders missing error states
- No cancellation tokens for http requests

---

## USER EXPERIENCE ISSUES

### 1. **Navigation Flow** ⚠️
```
Login → Dashboard → Mode Selection → Wizard
        ↓ (back from wizard)
        Dashboard (not mode selection!)
```
**Issue**: Back navigation doesn't preserve context

### 2. **Credential Management** 🔴
- Users see credential modal in 3+ different places (confusing)
- Edit/Save/Clear buttons scattered
- No single source of truth

### 3. **Feedback & Status** ⚠️
- Snackbar messages: Sometimes too fast (1 sec), inconsistent styling
- Loading indicators: Basic CircularProgressIndicator (no animation, context)
- Success messages: Not always clear
- Missing: Toast notifications for non-blocking updates

### 4. **Missing Onboarding** ⚠️
- First-time user experience unclear
- "What's a sniper job?" not explained
- "Why do I need to save credentials?" not explained

### 5. **Accessibility** ⚠️
- No tooltip strings on most icons
- Insufficient contrast in some cards
- No semantic labels for screen readers
- Missing: Alt text for images

---

## IMMEDIATE FIXES (PRIORITY ORDER)

### 🔴 CRITICAL (Do First)
1. **Extract credential modal to shared widget**
2. **Refactor dashboard into smaller components**
3. **Fix admin dashboard color scheme to green**
4. **Standardize error handling + user feedback**

### ⚠️ HIGH (Do Second)
5. **Add draft auto-save to new_job_wizard** (copy from sniper)
6. **Extract weather/news/recent runs as separate widgets**
7. **Standardize color palette + typography**
8. **Fix responsive layout (max-width values)**

### 📋 MEDIUM (Polish)
9. **Improve loading state animations**
10. **Add tooltips to all icon buttons**
11. **Consolidate form field styling**
12. **Add back navigation guards**

### 💡 LOW (Enhancement)
13. **Add onboarding screens**
14. **Add accessibility improvements**
15. **Add haptic feedback on button taps**
16. **Add transition animations between screens**

---

## DESIGN RECOMMENDATIONS

### 1. **Unified Color System**
```dart
// Define once in theme.dart
class AppColors {
  static const primary = Color(0xFF2E7D32); // Green
  static const secondary = Color(0xFFFFC107); // Gold/Amber
  static const warning = Color(0xFFFFC107); // Amber
  static const error = Color(0xFFD32F2F); // Red
  static const success = Color(0xFF4CAF50); // Bright Green
  static const info = Color(0xFF2196F3); // Blue
  // Use throughout app instead of hardcoded colors
}
```

### 2. **Spacing Scale**
```dart
class AppSpacing {
  static const xs = 4.0;
  static const sm = 8.0;
  static const md = 12.0;
  static const lg = 16.0;
  static const xl = 24.0;
  static const xxl = 32.0;
}
// Use: EdgeInsets.all(AppSpacing.lg) instead of 16, 20, 24 mixed
```

### 3. **Typography Scale**
```dart
// Use Material Design 3 typography
titleLarge: for page titles
titleMedium: for card titles, section headers
bodyMedium: for general text
bodySmall: for helper text, captions
```

### 4. **Card Standardization**
```dart
// All cards use:
borderRadius: BorderRadius.circular(16)
elevation: 4
padding: EdgeInsets.all(AppSpacing.xl)
```

### 5. **Button Standardization**
```dart
// Primary action: FilledButton (green)
// Secondary action: OutlinedButton (green outline)
// Tertiary action: TextButton (green text)
// Always: padding: EdgeInsets.symmetric(vertical: 16)
```

---

## FILE STRUCTURE RECOMMENDATIONS

### Current (Problematic)
```
lib/screens/
  ├── dashboard_screen.dart (2784 lines) 🔴
  ├── new_job_wizard.dart (1751 lines)
  ├── sniper_job_wizard.dart (1270 lines) ✅
  └── ...
```

### Proposed (Scalable)
```
lib/
├── screens/
│   ├── login_screen.dart ✅
│   ├── mode_selection_screen.dart ⚠️
│   ├── dashboard_screen.dart (refactored: 300-400 lines)
│   ├── wizards/
│   │   ├── new_job_wizard.dart (refactored: 600-800 lines)
│   │   ├── pages/
│   │   │   ├── credentials_page.dart
│   │   │   ├── date_page.dart
│   │   │   ├── time_page.dart
│   │   │   ├── party_size_page.dart
│   │   │   └── players_page.dart
│   │   └── sniper_job_wizard.dart (refactored: 400-500 lines)
│   ├── course_info_screen.dart ✅
│   └── admin_dashboard.dart ⚠️
├── widgets/
│   ├── brs_credentials_modal.dart (NEW - shared)
│   ├── weather_card.dart (extracted from dashboard)
│   ├── news_feed.dart (extracted from dashboard)
│   ├── recent_runs_card.dart (extracted from dashboard)
│   ├── job_card.dart (extracted from dashboard)
│   ├── prefetch_status_card.dart (extracted from dashboard)
│   ├── welcome_card.dart (extracted from dashboard)
│   └── mode_selection_card.dart ✅
└── theme/
    ├── colors.dart (NEW - unified palette)
    ├── spacing.dart (NEW - spacing scale)
    ├── typography.dart (NEW - font scale)
    └── theme_data.dart (updated to use above)
```

---

## ESTIMATED EFFORT & TIMELINE

| Task | Priority | Effort | Impact | Timeline |
|------|----------|--------|--------|----------|
| Extract credential modal | 🔴 CRITICAL | 2h | HIGH | Now |
| Refactor dashboard | 🔴 CRITICAL | 6h | CRITICAL | Next |
| Fix color scheme (admin) | 🔴 CRITICAL | 1h | MEDIUM | Now |
| Add draft auto-save (normal wizard) | ⚠️ HIGH | 1h | MEDIUM | Today |
| Extract dashboard widgets | ⚠️ HIGH | 4h | HIGH | Today |
| Standardize design system | ⚠️ HIGH | 3h | HIGH | Today |
| Polish animations/feedback | 📋 MEDIUM | 2h | MEDIUM | Later |
| **TOTAL** | - | **19h** | - | **2-3 days** |

---

## SUCCESS CRITERIA

After fixes, app should achieve:
- ✅ **8+/10 Design Consistency**: Single color palette, typography, spacing
- ✅ **8+/10 Code Quality**: No file > 800 lines, shared components extracted
- ✅ **8+/10 User Experience**: Clear navigation, helpful feedback, no confusion
- ✅ **7+/10 Polish**: Smooth animations, graceful error states, loading indicators
- ✅ **Production-Ready**: Could launch to App Store/Play Store with confidence

---

## NEXT ACTIONS

1. ✅ Create this audit document (DONE)
2. ⏳ **Extract shared credential modal** (Start immediately)
3. ⏳ **Refactor dashboard into components** (High priority)
4. ⏳ **Apply unified design system** (Parallel)
5. ⏳ **Add missing UX polish** (Final pass)
6. ⏳ **Test end-to-end flows** (Validation)

