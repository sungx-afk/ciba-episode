import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Header } from '../components/Header';
import { ConfirmDialog, DialogPayload } from '../components/ConfirmDialog';
import { Colors } from '../theme/colors';
import { useAuth } from '../context/AuthContext';
import { PayApi, VipStatus } from '../services/payApi';
import {
  FALLBACK_PLANS,
  FALLBACK_SKUS,
  MemberPlan,
  PRICE_TAG_VERSION,
  priceTagToPlan,
} from '../config/iapConfig';
import { AGREEMENT_URL, POLICY_URL } from '../config/legal';
import {
  IapProduct,
  IapPurchase,
  appAccountTokenFromUserId,
  buySubscription,
  endIap,
  fetchRestoreablePurchases,
  fetchSubscriptions,
  finishPurchase,
  initIap,
  isIapSupported,
  isSandboxPurchase,
  isUserCancelled,
  onPurchaseError,
  onPurchaseUpdate,
  openManageSubscriptions,
} from '../services/iapService';

const BENEFITS = ['词库全解锁：高中 / 四级 / 考研 / 托福', '后续新增词库免费用'];

interface PurchaseScreenProps {
  navigation: any;
}

/** 票据校验结果 */
interface VerifyResult {
  ok: boolean;
  endDate?: string;
  message?: string;
}

/** 2027-09-15 00:00:00 -> 2027-09-15 */
function formatDate(text?: string): string {
  if (!text) return '';
  const date = String(text).trim();
  return date.length >= 10 ? date.slice(0, 10) : date;
}

/**
 * 内购错误文案：拼成「[错误码] 原始信息」。
 * 失败原因大多在系统层（Apple ID 状态、购买限制、交易队列等），
 * 只显示 localizedDescription 无法定位，带上 code（E_UNKNOWN / E_USER_CANCELLED 等）
 * 才能区分是系统拒绝还是参数问题。
 */
function describeIapError(e: any, fallback: string): string {
  const code = e?.code ? String(e.code) : '';
  const message = e?.message || fallback;
  return code ? `[${code}] ${message}` : message;
}

/**
 * 服务端业务错误文案：拼成「（错误码 X）原始信息」。
 * /pay/ios/verify 失败时后端在 msg 里给出具体原因（核销失败、参数缺失等），
 * 带上 result 才能区分是网络问题还是服务端拒绝了这次核销。
 */
function describeServerError(e: any, fallback: string): string {
  const result = e?.result !== undefined && e?.result !== null ? String(e.result) : '';
  const message = e?.message || fallback;
  return result ? `（错误码 ${result}）${message}` : message;
}

export const PurchaseScreen: React.FC<PurchaseScreenProps> = ({ navigation }) => {
  const { user, isLoggedIn, refreshUserInfo } = useAuth();

  const [selectedPlanId, setSelectedPlanId] = useState<string>(FALLBACK_PLANS[0].id);
  /** 套餐列表：由服务端 /pay/price_tags 下发，接口异常时回退到 FALLBACK_PLANS */
  const [plans, setPlans] = useState<MemberPlan[]>(FALLBACK_PLANS);
  const [plansError, setPlansError] = useState<string | null>(null);
  const [products, setProducts] = useState<Record<string, IapProduct>>({});
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [buying, setBuying] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [vip, setVip] = useState<VipStatus | null>(null);
  /** 统一弹窗状态：确认/提示一律走 ConfirmDialog，不再使用系统 Alert */
  const [dialog, setDialog] = useState<DialogPayload | null>(null);

  /** 只有一个「确定」的纯提示弹窗 */
  const showNotice = useCallback((title: string, message: string) => {
    setDialog({ title, message, showCancel: false });
  }, []);

  // 本次主动购买的 Promise 控制器（结果由原生回调驱动）
  const pendingRef = useRef<{
    resolve: (p: IapPurchase) => void;
    reject: (e: any) => void;
  } | null>(null);
  // 供原生回调读取最新状态，避免闭包过期
  const verifyRef = useRef<(p: IapPurchase, silent?: boolean) => Promise<VerifyResult>>(
    async () => ({ ok: false })
  );
  const isLoggedInRef = useRef(isLoggedIn);
  const vipRef = useRef(vip);
  const plansRef = useRef(plans);
  useEffect(() => {
    isLoggedInRef.current = isLoggedIn;
  }, [isLoggedIn]);
  useEffect(() => {
    vipRef.current = vip;
  }, [vip]);
  useEffect(() => {
    plansRef.current = plans;
  }, [plans]);

  const appAccountToken = useMemo(
    () => (user ? appAccountTokenFromUserId(user.id) : undefined),
    [user?.id]
  );

  const selectedPlan: MemberPlan =
    plans.find((p) => p.id === selectedPlanId) || plans[0] || FALLBACK_PLANS[0];
  const selectedProduct = products[selectedPlan.sku];

  const refreshVip = useCallback(async () => {
    try {
      const status = await PayApi.getVipStatus();
      setVip(status);
    } catch {
      // 未登录 / 网络异常时忽略，页面按「非会员」展示
    }
  }, []);

  /**
   * 拉取服务端价签 -> 本地套餐，返回本次要向 StoreKit 查询的产品 ID。
   * 档位、名称、产品 ID、价签 id 全部以服务端为准。
   */
  const loadPlans = useCallback(async (): Promise<string[]> => {
    try {
      const tags = await PayApi.listPriceTags(PRICE_TAG_VERSION);
      const mapped = tags
        .map(priceTagToPlan)
        .filter((p): p is MemberPlan => !!p && !!p.sku);
      if (!mapped.length) {
        setPlans(FALLBACK_PLANS);
        setPlansError('暂无可购买的会员套餐');
        return FALLBACK_SKUS;
      }
      // 周期长的排前面
      mapped.sort((a, b) => b.months - a.months);
      setPlans(mapped);
      setSelectedPlanId((prev) =>
        mapped.some((p) => p.id === prev) ? prev : mapped[0].id
      );
      setPlansError(null);
      return mapped.map((p) => p.sku);
    } catch (e: any) {
      setPlans(FALLBACK_PLANS);
      setPlansError(e?.message || '套餐加载失败，已展示默认套餐');
      return FALLBACK_SKUS;
    }
  }, []);

  /**
   * 把票据交给服务端校验，成功后才结束事务（避免掉单）。
   * silent = true 用于启动补单，不弹窗。
   */
  const verifyPurchase = useCallback(
    async (purchase: IapPurchase, silent = false): Promise<VerifyResult> => {
      try {
        // 后端按 StoreKit 2 的 transaction_id 核销，拿不到就无法上报
        if (!purchase.transactionId) {
          return { ok: false, message: '未能获取支付凭证，请点击「恢复购买」重试' };
        }
        const plan = plansRef.current.find((p) => p.sku === purchase.productId);
        const res = await PayApi.verifyAppleReceipt({
          transaction_id: purchase.transactionId,
          product_id: purchase.productId,
          original_transaction_id: purchase.originalTransactionId,
          transaction_date: purchase.transactionDate,
          is_sandbox: isSandboxPurchase(purchase),
          tag_id: plan?.tagId,
          app_account_token: appAccountToken,
        });

        /**
         * 二次校验：核销接口返回成功 ≠ 会员真的开通了。
         * 服务端对「核销失败」也可能返回 result: 0/1（见 PayApi.verifyAppleReceipt 注释），
         * 所以要按会员状态再确认一次，没开通就必须按失败处理。
         */
        let status: VipStatus | null = null;
        let statusError: any = null;
        try {
          status = await PayApi.getVipStatus();
        } catch (e) {
          // 状态查询是辅助确认，查不到时按服务端返回的字段兜底，不能直接判失败
          statusError = e;
        }

        if (status && !status.isVip) {
          console.warn('[IAP] 核销返回成功但会员未开通', JSON.stringify(res));
          return {
            ok: false,
            message: res?.msg || '服务端未能开通会员，请检查网络或稍后重试',
          };
        }

        await finishPurchase(purchase);
        await refreshUserInfo();
        if (status) {
          setVip(status);
        } else {
          void refreshVip();
        }
        if (statusError) console.warn('[IAP] 会员状态查询失败', statusError);
        return { ok: true, endDate: status?.endDate || res?.end_date };
      } catch (e: any) {
        return {
          ok: false,
          message: describeServerError(e, '票据校验失败，请稍后重试'),
        };
      }
    },
    [appAccountToken, refreshUserInfo, refreshVip]
  );

  useEffect(() => {
    verifyRef.current = verifyPurchase;
  }, [verifyPurchase]);

  /** 进入页面：拉取套餐（服务端价签）、建立内购连接、取 StoreKit 价格、补单 */
  useEffect(() => {
    let disposed = false;
    let unsubUpdate: (() => void) | null = null;
    let unsubError: (() => void) | null = null;

    (async () => {
      await refreshVip();
      // 先拿服务端价签，产品 ID 由服务端下发
      const skus = await loadPlans();
      if (disposed) return;
      if (!isIapSupported()) {
        if (!disposed) setLoadingProducts(false);
        return;
      }
      try {
        await initIap();
        if (disposed) return;

        unsubUpdate = onPurchaseUpdate((purchase) => {
          const pending = pendingRef.current;
          if (pending) {
            pendingRef.current = null;
            pending.resolve(purchase);
            return;
          }
          // 非主动购买：上次未完成的事务 / 自动续期，静默补单
          void verifyRef.current(purchase, true);
        });
        unsubError = onPurchaseError((error) => {
          const pending = pendingRef.current;
          if (!pending) return;
          pendingRef.current = null;
          pending.reject(error);
        });

        const list = await fetchSubscriptions(skus);
        if (disposed) return;
        const map: Record<string, IapProduct> = {};
        list.forEach((p) => {
          map[p.productId] = p;
        });
        setProducts(map);
        if (!list.length) {
          setProductsError('暂未获取到商品价格，请确认 App Store 订阅已生效');
        }

        // 补单：上次支付成功但服务端未确认的订单。
        // 它底层是 SKPaymentQueue.restoreCompletedTransactions()，
        // 设备 Apple ID 状态异常（未登录 / 正式与沙箱账号错配 / 开启购买限制）时会直接失败，
        // 但这不影响本页正常发起购买，所以只记日志，不提示用户。
        if (isLoggedInRef.current && !vipRef.current?.isVip) {
          try {
            const unfinished = await fetchRestoreablePurchases();
            if (disposed) return;
            for (const item of unfinished) {
              const result = await verifyRef.current(item, true);
              if (result.ok) break;
            }
          } catch (e: any) {
            console.warn('[IAP] 补单失败（不影响购买）', e?.code, e?.message);
          }
        }
      } catch (e: any) {
        if (!disposed) setProductsError(describeIapError(e, '无法连接 App Store，请稍后重试'));
      } finally {
        if (!disposed) setLoadingProducts(false);
      }
    })();

    return () => {
      disposed = true;
      unsubUpdate?.();
      unsubError?.();
      if (!pendingRef.current) void endIap();
    };
  }, [refreshVip, loadPlans]);

  const promptLogin = (message: string) => {
    setDialog({
      title: '请先登录',
      message,
      confirmText: '去登录',
      onConfirm: () => {
        setDialog(null);
        navigation.navigate('Login');
      },
    });
  };

  const handleBuy = async () => {
    if (!isLoggedIn) {
      promptLogin('会员权益需要绑定账号，换设备后可一键恢复');
      return;
    }
    if (!isIapSupported()) {
      showNotice('提示', 'App Store 内购仅支持 iOS 真机');
      return;
    }
    // 价格展示不出来时不允许发起支付
    if (!priceAvailable) {
      showNotice('提示', '暂时无法获取商品价格，请检查网络后重试');
      return;
    }
    setBuying(true);
    try {
      const purchase = await new Promise<IapPurchase>((resolve, reject) => {
        pendingRef.current = { resolve, reject };
        buySubscription(selectedPlan.sku, appAccountToken).catch((e) => {
          if (pendingRef.current) {
            pendingRef.current = null;
          }
          reject(e);
        });
      });
      const result = await verifyPurchase(purchase);
      if (result.ok) {
        showNotice(
          '开通成功',
          result.endDate
            ? `会员有效期至 ${formatDate(result.endDate)}`
            : '会员权益已开通，感谢你的支持！'
        );
      } else {
        showNotice('开通失败', result.message || '票据校验失败，请点击「恢复购买」重试');
      }
    } catch (e: any) {
      // 用户主动取消不打扰
      if (e?.userCancelled || isUserCancelled(e)) return;
      showNotice('购买未完成', describeIapError(e, '请稍后重试'));
    } finally {
      setBuying(false);
    }
  };

  const handleRestore = async () => {
    if (!isLoggedIn) {
      promptLogin('恢复购买需要登录原账号');
      return;
    }
    if (!isIapSupported()) {
      showNotice('提示', 'App Store 内购仅支持 iOS 真机');
      return;
    }
    setRestoring(true);
    try {
      await initIap();
      const purchases = await fetchRestoreablePurchases();
      if (!purchases.length) {
        showNotice('没有可恢复的订单', '当前 Apple ID 下未查询到已购买的会员订单');
        return;
      }
      // 从最近的一笔开始逐笔核销，全部失败时把服务端的错误信息提示出来
      const sorted = [...purchases].sort(
        (a, b) => (b.transactionDate || 0) - (a.transactionDate || 0)
      );
      let lastError = '未能恢复购买，请检查网络或 Apple ID';
      for (const item of sorted) {
        const result = await verifyPurchase(item, true);
        if (result.ok) {
          showNotice(
            '恢复成功',
            result.endDate
              ? `会员有效期至 ${formatDate(result.endDate)}`
              : '会员权益已恢复到当前账号'
          );
          return;
        }
        if (result.message) lastError = result.message;
      }
      showNotice('恢复失败', lastError);
    } catch (e: any) {
      showNotice('恢复失败', describeIapError(e, '未能恢复购买，请检查网络或 Apple ID'));
    } finally {
      setRestoring(false);
    }
  };

  const openManageSubscription = async () => {
    const opened = await openManageSubscriptions();
    if (!opened) {
      showNotice('提示', '无法打开订阅管理页，可在 App Store → 账户 → 订阅中管理');
    }
  };

  /**
   * 金额一律取 StoreKit 返回的 displayPrice，
   * 拿不到就显示占位符，绝不用本地写死的价格（Guideline 2.1 / 3.1.1）。
   */
  const priceTextOf = (plan: MemberPlan): string | null =>
    products[plan.sku]?.localizedPrice || null;

  /**
   * 「省 X%」用 StoreKit 返回的价格数值换算，
   * 只展示比例、不自己拼接任何金额文案。
   */
  const savePercentOf = (plan: MemberPlan): number | null => {
    if (plan.months <= 1) return null;
    const monthlyPlan = plans.find((p) => p.months === 1);
    const target = products[plan.sku]?.price;
    const monthly = monthlyPlan ? products[monthlyPlan.sku]?.price : undefined;
    if (!target || !monthly) return null;
    const percent = Math.round((1 - target / (monthly * plan.months)) * 100);
    return percent > 0 ? percent : null;
  };

  // 拿不到价格时不允许发起支付（无法向用户展示应扣金额）
  const priceAvailable = !!selectedProduct?.localizedPrice;
  const busy = buying || restoring;

  /**
   * 计价币种由 Apple ID 所在商店地区决定，客户端改不了（Guideline 2.1 / 3.1.1）。
   * 非人民币时明确告知，避免用户把美元价格当成人民币。
   */
  const currencyHint =
    selectedProduct?.currency && selectedProduct.currency !== 'CNY'
      ? `当前按 App Store 账户地区（${selectedProduct.currency}）计价，实际扣款币种与 Apple ID 所在地区一致。`
      : '';

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.background} />
      <Header title="升级会员" onBack={() => navigation.goBack()} />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {/* 已是会员时的状态卡 */}
        {vip?.isVip ? (
          <View style={styles.vipBanner}>
            <Ionicons name="diamond" size={18} color={Colors.gold} />
            <View style={styles.vipBannerTextWrap}>
              <Text style={styles.vipBannerTitle}>VIP 会员已开通</Text>
              <Text style={styles.vipBannerSub}>
                {vip.endDate ? `有效期至 ${formatDate(vip.endDate)}` : '权益生效中'}
              </Text>
            </View>
            <TouchableOpacity style={styles.vipManageBtn} onPress={openManageSubscription} activeOpacity={0.7}>
              <Text style={styles.vipManageText}>管理订阅</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* 权益卡片 */}
        <View style={styles.benefitCard}>
          <Text style={styles.benefitTitle}>解锁全部权益</Text>
          {BENEFITS.map((item, index) => (
            <View key={index} style={styles.benefitRow}>
              <Ionicons
                name="checkmark"
                size={16}
                color={Colors.primary}
                style={styles.checkIcon}
              />
              <Text style={styles.benefitText}>{item}</Text>
            </View>
          ))}
        </View>

        {/* 未登录提示 */}
        {!isLoggedIn ? (
          <TouchableOpacity
            style={styles.loginTip}
            activeOpacity={0.7}
            onPress={() => promptLogin('会员权益需要绑定账号，换设备后可一键恢复')}
          >
            <Ionicons name="person-circle-outline" size={16} color={Colors.primary} />
            <Text style={styles.loginTipText}>登录后购买，换设备也能恢复会员</Text>
            <Text style={styles.loginTipAction}>去登录</Text>
          </TouchableOpacity>
        ) : null}

        {/* 套餐选择 */}
        <View style={styles.plansContainer}>
          {plans.map((plan) => {
            const selected = plan.id === selectedPlanId;
            const priceText = priceTextOf(plan);
            const savePercent = savePercentOf(plan);
            return (
              <TouchableOpacity
                key={plan.id}
                activeOpacity={0.8}
                onPress={() => setSelectedPlanId(plan.id)}
                style={[styles.planCard, selected && styles.planCardSelected]}
                disabled={busy}
              >
                <View style={styles.planLeft}>
                  <View style={[styles.radio, selected && styles.radioSelected]}>
                    {selected ? <View style={styles.radioDot} /> : null}
                  </View>
                  <View style={styles.planInfo}>
                    <View style={styles.planTitleRow}>
                      <Text style={styles.planTitle}>{plan.label}</Text>
                      {savePercent ? (
                        <View style={styles.saveBadge}>
                          <Text style={styles.saveBadgeText}>省 {savePercent}%</Text>
                        </View>
                      ) : null}
                    </View>
                    {/* 副标题用服务端价签名 / StoreKit 商品名，避免自行描述价格 */}
                    <Text style={styles.planMonthly} numberOfLines={1}>
                      {products[plan.sku]?.title || plan.tagName || ' '}
                    </Text>
                  </View>
                </View>

                <View style={styles.planRight}>
                  {loadingProducts ? (
                    <ActivityIndicator size="small" color={Colors.textMuted} />
                  ) : priceText ? (
                    <Text style={styles.planPrice}>{priceText}</Text>
                  ) : (
                    <Text style={styles.planPriceUnavailable}>—</Text>
                  )}
                </View>
              </TouchableOpacity>
            );
          })}
          {plansError ? <Text style={styles.productsErrorText}>{plansError}</Text> : null}
          {productsError && !loadingProducts ? (
            <Text style={styles.productsErrorText}>{productsError}</Text>
          ) : null}
        </View>

        {/* 购买：金额只展示 StoreKit 返回的 displayPrice */}
        <TouchableOpacity
          style={[styles.buyButton, (busy || !priceAvailable) && styles.buyButtonDisabled]}
          activeOpacity={0.7}
          onPress={handleBuy}
          disabled={busy || !priceAvailable}
        >
          {buying ? (
            <ActivityIndicator size="small" color={Colors.primary} />
          ) : (
            <Text style={styles.buyButtonText}>
              {vip?.isVip ? '续费会员' : '立即开通'}
              {priceAvailable ? ` · ${selectedProduct?.localizedPrice}` : ''}
            </Text>
          )}
        </TouchableOpacity>

        {!priceAvailable && !loadingProducts ? (
          <Text style={styles.productsErrorText}>暂时无法获取商品价格，请检查网络后重试</Text>
        ) : null}

        {currencyHint ? <Text style={styles.currencyHintText}>{currencyHint}</Text> : null}

        <Text style={styles.subscriptionHint}>
          自动续费订阅，可随时在 App Store 的「订阅」中管理或取消。
          {vip?.isVip ? '' : '确认购买后将从你的 Apple ID 账户扣款。'}
        </Text>

        {/* 恢复购买 / 管理订阅 */}
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={styles.actionBtn}
            activeOpacity={0.7}
            onPress={handleRestore}
            disabled={busy}
          >
            {restoring ? (
              <ActivityIndicator size="small" color={Colors.textSecondary} />
            ) : (
              <Ionicons name="refresh-outline" size={15} color={Colors.textSecondary} />
            )}
            <Text style={styles.actionBtnText}>恢复购买</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} activeOpacity={0.7} onPress={openManageSubscription}>
            <Ionicons name="settings-outline" size={15} color={Colors.textSecondary} />
            <Text style={styles.actionBtnText}>管理订阅</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.footerLinks}>
          <TouchableOpacity
            activeOpacity={0.6}
            onPress={() =>
              navigation.navigate('WebPage', { url: AGREEMENT_URL, title: '用户协议' })
            }
          >
            <Text style={styles.footerLink}>用户协议</Text>
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.6}
            onPress={() => navigation.navigate('WebPage', { url: POLICY_URL, title: '隐私政策' })}
          >
            <Text style={styles.footerLink}>隐私政策</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <ConfirmDialog
        visible={dialog !== null}
        title={dialog?.title || ''}
        message={dialog?.message || ''}
        confirmText={dialog?.confirmText}
        cancelText={dialog?.cancelText}
        showCancel={dialog?.showCancel}
        onConfirm={dialog?.onConfirm}
        onCancel={dialog?.onCancel}
        onClose={() => setDialog(null)}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  vipBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.darkCard,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 16,
  },
  vipBannerTextWrap: {
    flex: 1,
    marginLeft: 10,
  },
  vipBannerTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.card,
  },
  vipBannerSub: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.6)',
    marginTop: 2,
  },
  vipManageBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.gold,
  },
  vipManageText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.gold,
  },
  benefitCard: {
    backgroundColor: Colors.darkCard,
    borderRadius: 16,
    padding: 20,
    marginTop: 16,
  },
  benefitTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.card,
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 12,
  },
  checkIcon: {
    marginRight: 8,
    marginTop: 1,
  },
  benefitText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    color: 'rgba(255, 255, 255, 0.85)',
  },
  loginTip: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    backgroundColor: Colors.primaryLight,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  loginTipText: {
    flex: 1,
    fontSize: 13,
    color: Colors.textSecondary,
    marginLeft: 8,
  },
  loginTipAction: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.primary,
  },
  plansContainer: {
    marginTop: 24,
  },
  planCard: {
    backgroundColor: Colors.card,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
    paddingVertical: 16,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  planCardSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryLight,
  },
  planLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: Colors.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  radioSelected: {
    borderColor: Colors.primary,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.primary,
  },
  planInfo: {
    flex: 1,
  },
  planTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  planTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginRight: 8,
  },
  saveBadge: {
    backgroundColor: Colors.danger,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  saveBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.card,
  },
  planMonthly: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 4,
  },
  planRight: {
    alignItems: 'flex-end',
    marginLeft: 12,
    minWidth: 70,
  },
  planPrice: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  // 取不到 StoreKit 价格时的占位符，禁止回退成写死的金额
  planPriceUnavailable: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  productsErrorText: {
    fontSize: 12,
    color: Colors.danger,
    textAlign: 'center',
    marginTop: 4,
  },
  buyButton: {
    backgroundColor: Colors.card,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    borderRadius: 24,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  buyButtonDisabled: {
    opacity: 0.6,
  },
  buyButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.primary,
  },
  subscriptionHint: {
    fontSize: 12,
    lineHeight: 18,
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: 16,
  },
  currencyHintText: {
    fontSize: 12,
    lineHeight: 18,
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: 10,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 20,
    gap: 24,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  actionBtnText: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  footerLinks: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 24,
    marginTop: 24,
  },
  footerLink: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
});
