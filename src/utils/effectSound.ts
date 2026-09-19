import { Audio } from 'expo-av';

/**
 * 「标记为已记住」的提示音。
 * 音频很短（1.4s AAC），只在第一次播放时加载并常驻内存，之后每次回到开头重播，
 * 连续标记时不会重复创建 Sound 实例。
 */

let sound: Audio.Sound | null = null;
let loading: Promise<Audio.Sound> | null = null;

export async function playRememberedSound(): Promise<void> {
  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      // 跟随系统静音开关：静音时不打断用户
      playsInSilentModeIOS: false,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
    });

    if (!sound) {
      if (!loading) {
        loading = Audio.Sound.createAsync(require('../assets/remember.mp4')).then(
          (result) => result.sound
        );
      }
      sound = await loading;
    }

    await sound.setPositionAsync(0);
    await sound.playAsync();
  } catch {
    // 音效播放失败不影响标记流程，静默忽略
  }
}
