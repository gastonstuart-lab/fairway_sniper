import 'dart:convert';
import 'package:http/http.dart' as http;

class WeatherService {
  static const String _baseUrl = 'https://api.open-meteo.com/v1/forecast';
  static const double galgormLat = 54.8614;
  static const double galgormLon = -6.2069;

  Future<Map<String, dynamic>?> getCurrentWeather() async {
    try {
      final url = Uri.parse(
        '$_baseUrl?latitude=$galgormLat&longitude=$galgormLon'
        '&current=temperature_2m,weathercode,windspeed_10m,relativehumidity_2m'
        '&timezone=Europe/London',
      );

      final response = await http.get(url);
      
      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        return data;
      }
    } catch (e) {
      return null;
    }
    return null;
  }

  Future<Map<String, dynamic>?> getWeatherForecast(DateTime targetDate) async {
    try {
      final startDate = targetDate.toIso8601String().split('T')[0];
      final endDate = targetDate.add(const Duration(days: 7)).toIso8601String().split('T')[0];
      
      final url = Uri.parse(
        '$_baseUrl?latitude=$galgormLat&longitude=$galgormLon'
        '&start_date=$startDate&end_date=$endDate'
        '&hourly=temperature_2m,weathercode,windspeed_10m,precipitation_probability'
        '&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max,windspeed_10m_max'
        '&timezone=Europe/London',
      );

      final response = await http.get(url);
      
      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        return data;
      }
    } catch (e) {
      return null;
    }
    return null;
  }

  Map<String, dynamic>? getHourlyWeatherForTime(Map<String, dynamic> forecastData, String teeTime) {
    try {
      final hourly = forecastData['hourly'];
      if (hourly == null) return null;
      
      final times = hourly['time'] as List;
      final hour = int.parse(teeTime.split(':')[0]);
      
      for (int i = 0; i < times.length; i++) {
        final timeStr = times[i] as String;
        final dateTime = DateTime.parse(timeStr);
        
        if (dateTime.hour == hour) {
          return {
            'temperature': hourly['temperature_2m'][i],
            'weathercode': hourly['weathercode'][i],
            'windspeed': hourly['windspeed_10m'][i],
            'precipitation_probability': hourly['precipitation_probability'][i],
            'time': timeStr,
          };
        }
      }
    } catch (e) {
      return null;
    }
    return null;
  }

  String getWeatherDescription(int weatherCode) {
    if (weatherCode == 0) return 'Clear sky';
    if (weatherCode <= 3) return 'Partly cloudy';
    if (weatherCode <= 48) return 'Foggy';
    if (weatherCode <= 67) return 'Rainy';
    if (weatherCode <= 77) return 'Snowy';
    if (weatherCode <= 82) return 'Rain showers';
    if (weatherCode <= 86) return 'Snow showers';
    if (weatherCode <= 99) return 'Thunderstorm';
    return 'Unknown';
  }

  String getWeatherEmoji(int weatherCode) {
    if (weatherCode == 0) return '☀️';
    if (weatherCode <= 3) return '⛅';
    if (weatherCode <= 48) return '🌫️';
    if (weatherCode <= 67) return '🌧️';
    if (weatherCode <= 77) return '❄️';
    if (weatherCode <= 82) return '🌦️';
    if (weatherCode <= 86) return '🌨️';
    if (weatherCode <= 99) return '⛈️';
    return '🌤️';
  }
}
