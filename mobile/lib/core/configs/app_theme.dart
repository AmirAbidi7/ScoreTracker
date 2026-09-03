import 'package:flutter/material.dart';
import 'package:mobile/core/configs/app_colors.dart';

class AppTheme {
  static final darkTheme = ThemeData(
    fontFamily: 'Pixeloid',
    primaryColor: AppColors.primary,
    scaffoldBackgroundColor: AppColors.darkBackground,
    brightness: .dark,
    inputDecorationTheme: InputDecorationThemeData(
      filled: true,
      fillColor: AppColors.darkBackground,
      contentPadding: const EdgeInsetsGeometry.symmetric(
        vertical: 8,
        horizontal: 12,
      ),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(0),
        borderSide: const BorderSide(color: AppColors.grey, width: 0.4),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(0),
        borderSide: const BorderSide(color: AppColors.secondary, width: 0.4),
      ),
      hintStyle: const TextStyle(
        fontFamily: 'Pixeloid',
        color: AppColors.darkGrey,
      ),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: AppColors.darkBackground,
        foregroundColor: AppColors.primary,
        textStyle: const TextStyle(
          color: AppColors.primary,
          fontFamily: 'Pixeloid',
          fontWeight: .bold,
        ),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadiusGeometry.circular(0),
          side: const BorderSide(color: AppColors.secondary, width: 0.8),
        ),
      ),
    ),
  );
}
