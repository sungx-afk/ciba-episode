import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Colors } from '../theme/colors';

import { HomeScreen } from '../screens/HomeScreen';
import { BookmarksScreen } from '../screens/BookmarksScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { WordListScreen } from '../screens/WordListScreen';
import { FlashcardScreen } from '../screens/FlashcardScreen';
import { BookmarkStudyScreen } from '../screens/BookmarkStudyScreen';
import { BookSelectScreen } from '../screens/BookSelectScreen';
import { MarketScreen } from '../screens/MarketScreen';
import { MyPacksScreen } from '../screens/MyPacksScreen';
import { SubPacksScreen } from '../screens/SubPacksScreen';
import { PurchaseScreen } from '../screens/PurchaseScreen';
import { WebPageScreen } from '../screens/WebPageScreen';

import { LoginScreen } from '../screens/auth/LoginScreen';
import { RegisterScreen } from '../screens/auth/RegisterScreen';
import { ForgotPasswordScreen } from '../screens/auth/ForgotPasswordScreen';
import { ChangePasswordScreen } from '../screens/auth/ChangePasswordScreen';

const Stack = createNativeStackNavigator();

/**
 * 导航结构：单栈，无底部 tab。
 * 首页（Home）承载用户信息 / 生词本 / 我的卡组三段内容与电脑端插件说明，
 * 生词本列表（Bookmarks）与「我的」（Profile）作为二级页面从首页进入。
 */
export function RootNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: Colors.background },
          animation: 'slide_from_right',
        }}
      >
        {/* 首屏：首页（唯一入口） */}
        <Stack.Screen name="Home" component={HomeScreen} />

        {/* 首页二级页面 */}
        <Stack.Screen name="Bookmarks" component={BookmarksScreen} />
        <Stack.Screen name="Profile" component={ProfileScreen} />

        {/* 学习流程 */}
        <Stack.Screen name="WordList" component={WordListScreen} />
        <Stack.Screen
          name="Flashcard"
          component={FlashcardScreen}
          options={{ animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="BookmarkStudy"
          component={BookmarkStudyScreen}
          options={{ animation: 'slide_from_bottom' }}
        />

        {/* 词库 / 卡组 / 会员 */}
        <Stack.Screen name="BookSelect" component={BookSelectScreen} />
        <Stack.Screen name="Market" component={MarketScreen} />
        {/* 我的卡组列表 → 某个卡组的分类卡组列表（学习入口） */}
        <Stack.Screen name="MyPacks" component={MyPacksScreen} />
        <Stack.Screen name="SubPacks" component={SubPacksScreen} />
        <Stack.Screen
          name="Purchase"
          component={PurchaseScreen}
          options={{ animation: 'slide_from_bottom' }}
        />

        {/* 账号 */}
        <Stack.Screen
          name="Login"
          component={LoginScreen}
          options={{
            presentation: 'modal',
            animation: 'slide_from_bottom',
          }}
        />
        <Stack.Screen name="Register" component={RegisterScreen} />
        <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
        <Stack.Screen name="ChangePassword" component={ChangePasswordScreen} />

        {/* 内嵌网页（用户协议 / 会员说明等） */}
        <Stack.Screen name="WebPage" component={WebPageScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
