// 1. 最先装载全局异常捕获器与 globalThis.expo 兜底
import './src/utils/crashGuard';
import { addBootLog, subscribeFatalError } from './src/utils/crashGuard';

import React, { Component } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Platform,
  Share,
  Alert,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { registerRootComponent } from 'expo';
import App from './App';

/**
 * 顶级防白屏与紧急诊断启动器 (SafeAppLauncher)
 * 作用：如果任何下层组件、Provider、导航或三方库在初始化时发生严重异常导致白屏，
 * 本启动器将 100% 接管屏幕，渲染出清晰醒目的错误信息面板，绝不出现毫无反应的死白屏！
 */
class SafeAppLauncher extends Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      errorMessage: '',
      errorStack: '',
    };
    this.unsubFatal = null;
  }

  componentDidMount() {
    addBootLog('Launcher', 'SafeAppLauncher 根容器挂载成功');
    // 监听未捕获的全局 JS 异常或 Promise 拒绝
    this.unsubFatal = subscribeFatalError((err) => {
      this.setState({
        hasError: true,
        errorMessage: err?.message || '未知未捕获异常',
        errorStack: err?.stack || '',
      });
    });
  }

  componentWillUnmount() {
    if (this.unsubFatal) this.unsubFatal();
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      errorMessage: error?.message || '组件树异常',
      errorStack: error?.stack || '',
    };
  }

  componentDidCatch(error, info) {
    addBootLog('LauncherCatch', error?.message || '', 'error', error?.stack);
  }

  handleRestart = () => {
    this.setState({ hasError: false, errorMessage: '', errorStack: '' });
  };

  handleClearCacheAndRestart = async () => {
    try {
      await AsyncStorage.clear();
      this.setState({ hasError: false, errorMessage: '', errorStack: '' });
    } catch {
      this.setState({ hasError: false, errorMessage: '', errorStack: '' });
    }
  };

  handleCopyReport = async () => {
    try {
      const text = `=== 糍粑英语致命异常诊断报告 ===\n时间: ${new Date().toLocaleString()}\n错误信息:\n${this.state.errorMessage}\n\n错误堆栈:\n${this.state.errorStack}`;
      await Clipboard.setStringAsync(text);
      Alert.alert('已复制', '异常诊断报告已复制到剪贴板，可直接粘贴！');
    } catch (_) {
      Alert.alert('提示', '长按屏幕文本也可直接选择复制');
    }
  };

  handleShareReport = async () => {
    try {
      const text = `=== 糍粑英语致命异常诊断报告 ===\n时间: ${new Date().toLocaleString()}\n错误信息:\n${this.state.errorMessage}\n\n错误堆栈:\n${this.state.errorStack}`;
      await Share.share({ title: '糍粑英语启动异常', message: text });
    } catch (_) {}
  };

  render() {
    if (this.state.hasError) {
      return (
        <SafeAreaView style={styles.emergencyContainer}>
          <View style={styles.emergencyCard}>
            <Text style={styles.emergencyIcon}>🚨</Text>
            <Text style={styles.emergencyTitle}>应用启动遇到异常 (已阻止闪退)</Text>
            <Text style={styles.emergencySubtitle}>
              以下是阻碍正常显示的详细错误信息：
            </Text>

            <View style={styles.actionBtnRow}>
              <TouchableOpacity style={styles.copyBtn} onPress={this.handleCopyReport} activeOpacity={0.8}>
                <Text style={styles.copyBtnText}>📋 一键复制诊断报告</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.shareBtn} onPress={this.handleShareReport} activeOpacity={0.8}>
                <Text style={styles.shareBtnText}>📤 系统分享</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.msgBox}>
              <Text style={styles.msgText} selectable={true}>{this.state.errorMessage}</Text>
            </View>

            {this.state.errorStack ? (
              <ScrollView style={styles.stackBox}>
                <Text style={styles.stackText} selectable={true}>{this.state.errorStack}</Text>
              </ScrollView>
            ) : null}

            <View style={styles.btnRow}>
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={this.handleRestart}
                activeOpacity={0.8}
              >
                <Text style={styles.primaryBtnText}>重试加载</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={this.handleClearCacheAndRestart}
                activeOpacity={0.8}
              >
                <Text style={styles.secondaryBtnText}>清理缓存重载</Text>
              </TouchableOpacity>
            </View>
          </View>
        </SafeAreaView>
      );
    }

    return <App />;
  }
}

const styles = StyleSheet.create({
  emergencyContainer: {
    flex: 1,
    backgroundColor: '#141414',
    justifyContent: 'center',
    padding: 16,
  },
  emergencyCard: {
    backgroundColor: '#222222',
    borderRadius: 16,
    padding: 20,
    maxHeight: '90%',
  },
  emergencyIcon: {
    fontSize: 36,
    textAlign: 'center',
    marginBottom: 8,
  },
  emergencyTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FF5252',
    textAlign: 'center',
    marginBottom: 4,
  },
  emergencySubtitle: {
    fontSize: 12,
    color: '#AAAAAA',
    textAlign: 'center',
    marginBottom: 16,
  },
  msgBox: {
    backgroundColor: '#381A1A',
    borderColor: '#FF5252',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  msgText: {
    color: '#FFCDD2',
    fontSize: 13,
    fontWeight: '600',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  stackBox: {
    backgroundColor: '#111111',
    borderRadius: 8,
    padding: 10,
    maxHeight: 220,
    marginBottom: 16,
  },
  stackText: {
    color: '#888888',
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    lineHeight: 16,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 12,
  },
  primaryBtn: {
    flex: 1,
    backgroundColor: '#E8890F',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  secondaryBtn: {
    flex: 1,
    backgroundColor: '#333333',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  secondaryBtnText: {
    color: '#DDDDDD',
    fontWeight: '600',
    fontSize: 14,
  },
});

registerRootComponent(SafeAppLauncher);
