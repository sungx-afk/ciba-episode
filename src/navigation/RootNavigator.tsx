import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../theme/colors';

import { HomeScreen } from '../screens/HomeScreen';
import { BookmarksScreen } from '../screens/BookmarksScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { WordListScreen } from '../screens/WordListScreen';
import { FlashcardScreen } from '../screens/FlashcardScreen';
import { BookmarkStudyScreen } from '../screens/BookmarkStudyScreen';
import { BookSelectScreen } from '../screens/BookSelectScreen';
import { MarketScreen } from '../screens/MarketScreen';
import { PurchaseScreen } from '../screens/PurchaseScreen';
import { WebPageScreen } from '../screens/WebPageScreen';

import { LoginScreen } from '../screens/auth/LoginScreen';
import { RegisterScreen } from '../screens/auth/RegisterScreen';
import { ForgotPasswordScreen } from '../screens/auth/ForgotPasswordScreen';
import { ChangePasswordScreen } from '../screens/auth/ChangePasswordScreen';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function MainTabs() {
  const insets = useSafeAreaInsets();
  const bottomInset = Number(insets?.bottom) || 0;
  const tabBarHeight = 60 + bottomInset;

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textMuted,
        tabBarStyle: {
          backgroundColor: Colors.card,
          borderTopColor: Colors.border,
          borderTopWidth: 1,
          height: tabBarHeight,
          paddingBottom: bottomInset,
        },
        tabBarItemStyle: {
          justifyContent: 'center',
        },
        tabBarIconStyle: {
          marginBottom: 2,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          lineHeight: 16,
          fontWeight: '600',
        },
        tabBarIcon: ({ focused, color, size }) => {
          let iconName: keyof typeof Ionicons.glyphMap = 'grid';

          if (route.name === 'HomeTab') {
            iconName = focused ? 'grid' : 'grid-outline';
          } else if (route.name === 'BookmarksTab') {
            iconName = focused ? 'bookmark' : 'bookmark-outline';
          } else if (route.name === 'ProfileTab') {
            iconName = focused ? 'person' : 'person-outline';
          }

          return <Ionicons name={iconName} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen
        name="HomeTab"
        component={HomeScreen}
        options={{ tabBarLabel: '分类' }}
      />
      <Tab.Screen
        name="BookmarksTab"
        component={BookmarksScreen}
        options={{ tabBarLabel: '生词本' }}
      />
      <Tab.Screen
        name="ProfileTab"
        component={ProfileScreen}
        options={{ tabBarLabel: '我的' }}
      />
    </Tab.Navigator>
  );
}

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
        <Stack.Screen name="MainTabs" component={MainTabs} />
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
        <Stack.Screen name="BookSelect" component={BookSelectScreen} />
        <Stack.Screen name="Market" component={MarketScreen} />
        <Stack.Screen
          name="Purchase"
          component={PurchaseScreen}
          options={{ animation: 'slide_from_bottom' }}
        />
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

        <Stack.Screen  
          name="WebPage"
          component={WebPageScreen}
          options={{ animation: 'slide_from_right' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
