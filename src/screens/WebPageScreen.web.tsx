import React from 'react';
import { View, StyleSheet, SafeAreaView, StatusBar } from 'react-native';
import { Header } from '../components/Header';
import { Colors } from '../theme/colors';
import type { WebPageParams } from './WebPageScreen';

interface WebPageScreenProps {
  route: any;
  navigation: any;
}

// Web 端没有原生 WebView，用 iframe 承载同样的页面
export const WebPageScreen: React.FC<WebPageScreenProps> = ({ route, navigation }) => {
  const { url = '', title = '网页' } = (route?.params ?? {}) as WebPageParams;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.background} />
      <Header title={title} onBack={() => navigation.goBack()} />

      <View style={styles.container}>
        {React.createElement('iframe' as any, {
          src: url,
          title,
          style: {
            width: '100%',
            height: '100%',
            border: 'none',
            backgroundColor: Colors.card,
          },
        } as any)}
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
});
