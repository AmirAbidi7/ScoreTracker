import 'package:flutter/material.dart';
import 'package:mobile/core/configs/app_images.dart';

class OnboardingPage extends StatelessWidget {
  new({super.key});

  final PageController _pageController = PageController();
  final _startPage = 0;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: PageView.builder(
        controller: _pageController,
        itemCount: AppImages.onboardingImage.length,
        itemBuilder: (BuildContext context, int index) {},
      ),
    );
  }

  Widget _page(BuildContext context, int index, String title, String hook) {
    return Stack(
      children: [
        Container(
          padding: const EdgeInsetsGeometry.symmetric(
            vertical: 40,
            horizontal: 40,
          ),
          decoration: BoxDecoration(
            image: DecorationImage(
              fit: .fill,
              image: AssetImage(AppImages.onboardingImage[index]),
            ),
          ),
        ),
        Container(color: Colors.black),
      ],
    );
  }
}
