import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { Header } from '../components/Header';
import { Colors } from '../theme/colors';

export interface WebPageParams {
  url: string;
  title?: string;
}

interface WebPageScreenProps {
  route: any;
  navigation: any;
}

export const WebPageScreen: React.FC<WebPageScreenProps> = ({ route, navigation }) => {
  const { url = '', title = '网页' } = (route?.params ?? {}) as WebPageParams;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.background} />
      <Header title={title} onBack={() => navigation.goBack()} />

      <View style={styles.container}>
        <WebView
          source={{ uri: url }}
          startInLoadingState
          renderLoading={() => (
            <View style={[StyleSheet.absoluteFill, styles.center]}>
              <ActivityIndicator size="large" color={Colors.primary} />
            </View>
          )}
          renderError={() => (
            <View style={[StyleSheet.absoluteFill, styles.center]}>
              <Text style={styles.errorText}>页面加载失败，请检查网络后重试</Text>
            </View>
          )}
        />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  container: {
    flex: 1,
    backgroundColor: Colors.card,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
  },
  errorText: {
    fontSize: 14,
    color: Colors.textSecondary,
    paddingHorizontal: 24,
    textAlign: 'center',
  },
});
