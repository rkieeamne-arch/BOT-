/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from "react";
import { 
  Bot, 
  Shield, 
  Zap, 
  Settings, 
  ExternalLink, 
  Wifi, 
  AlertTriangle, 
  MessageSquare, 
  Send, 
  RefreshCw, 
  Gamepad2, 
  Trash2, 
  Award, 
  HelpCircle, 
  CheckCircle2, 
  Sliders, 
  Copy, 
  Users, 
  CreditCard, 
  Sparkles, 
  Layers, 
  Info, 
  Check, 
  Activity,
  Server,
  Save,
  Radio,
  Clock,
  ChevronLeft,
  Power,
  Coins,
  Wallet,
  TrendingUp,
  ArrowDownRight,
  ArrowUpRight
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface BotStatus {
  loggedIn: boolean;
  tag: string;
  clientId?: string;
  guilds: number;
  lastError: string | null;
  intentsRequested: string[];
}

interface TokenStats {
  totalGranted: number;
  totalSpentOnRoles: number;
  rolesCreatedWithTokensCount: number;
  circulatingTokens: number;
  totalUsersWithTokens: number;
  lastGrantedAt: string | null;
  lastSpentAt: string | null;
}

interface GuildInfo {
  id: string;
  name: string;
  icon: string | null;
  memberCount: number;
  rolePrice: number;
  tokenPrice: number;
  paymentAccount: string;
  paymentChannelId: string;
  allowedRoles: string[];
  freeRoleEnabled: boolean;
  gamesEnabled: boolean;
  moderationRoles?: Record<string, string[]>;
  moderationShortcuts?: Record<string, string>;
  logChannels?: Record<string, string>;
  confessionChannel?: string;
  confessionPanelChannel?: string;
}

interface DiscordRole {
  id: string;
  name: string;
  hexColor: string;
  managed: boolean;
  position: number;
}

interface ChannelInfo {
  id: string;
  name: string;
  guildId: string;
  guildName: string;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<"overview" | "config" | "messages" | "games" | "manual" | "mod" | "logs">("overview");
  
  // Bot Status State
  const [status, setStatus] = useState<BotStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  
  // Channels State
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string>("");
  const [isLoadingChannels, setIsLoadingChannels] = useState<boolean>(false);

  // Guilds & Live Config State
  const [guilds, setGuilds] = useState<GuildInfo[]>([]);
  const [selectedGuildId, setSelectedGuildId] = useState<string>("");
  const [isLoadingGuilds, setIsLoadingGuilds] = useState<boolean>(false);
  const [guildRoles, setGuildRoles] = useState<DiscordRole[]>([]);
  const [isLoadingRoles, setIsLoadingRoles] = useState<boolean>(false);

  // Config Form State for Selected Guild
  const [configForm, setConfigForm] = useState<{
    rolePrice: number;
    tokenPrice: number;
    paymentAccount: string;
    paymentChannelId: string;
    allowedRoles: string[];
    freeRoleEnabled: boolean;
    gamesEnabled: boolean;
    moderationRoles: Record<string, string[]>;
    moderationShortcuts: Record<string, string>;
    logChannels: Record<string, string>;
    confessionChannel?: string;
    confessionPanelChannel?: string;
  }>({
    rolePrice: 5000,
    tokenPrice: 10,
    paymentAccount: "",
    paymentChannelId: "",
    allowedRoles: [],
    freeRoleEnabled: true,
    gamesEnabled: true,
    moderationRoles: { ban: [], kick: [], timeout: [], warn: [], unban: [], untimeout: [], unwarn: [] },
    moderationShortcuts: { ban: "حظر", kick: "طرد", timeout: "تايم", warn: "تحذير", unban: "ازالة حظر", untimeout: "ازالة تايم", unwarn: "ازالة تحذير" },
    logChannels: { modLogs: "" },
    confessionChannel: "",
    confessionPanelChannel: "",
  });
  
  const [isSavingConfig, setIsSavingConfig] = useState<boolean>(false);
  const [isSendingConfession, setIsSendingConfession] = useState<boolean>(false);
  const [confessionStatusMsg, setConfessionStatusMsg] = useState<string | null>(null);
  const [isTogglingFeature, setIsTogglingFeature] = useState<string | null>(null);
  const [configStatusMsg, setConfigStatusMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Message Broadcast Console State
  const [messageText, setMessageText] = useState<string>("");
  const [isSendingMsg, setIsSendingMsg] = useState<boolean>(false);
  const [chatNotice, setChatNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Games Action State
  const [isGameActionPending, setIsGameActionPending] = useState<boolean>(false);
  const [gameNotice, setGameNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Copy Feedback
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Token Economy Stats
  const [tokenStats, setTokenStats] = useState<TokenStats | null>(null);
  const [isLoadingTokenStats, setIsLoadingTokenStats] = useState<boolean>(false);

  // Arab Country Roles Creation State
  const [isCreatingArabRoles, setIsCreatingArabRoles] = useState<boolean>(false);
  const [arabRolesSuccessMsg, setArabRolesSuccessMsg] = useState<string | null>(null);

  const [customClientId, setCustomClientId] = useState<string>(() => {
    return localStorage.getItem("custom_discord_client_id") || "";
  });

  const envClientId = import.meta.env.VITE_DISCORD_CLIENT_ID;
  const activeClientId = (envClientId && envClientId.trim() !== "" && envClientId !== "PLACEHOLDER") 
    ? envClientId.trim() 
    : (status?.clientId || customClientId || "1505307819648221194");
  const isIdMissing = !activeClientId || activeClientId.trim() === "";
  const inviteUrl = `https://discord.com/api/oauth2/authorize?client_id=${activeClientId.trim()}&permissions=8&scope=bot%20applications.commands`;

  // Fetch Bot Connection Status
  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/bot-status", { headers: { "Accept": "application/json" } });
      if (!res.ok) throw new Error(`خطأ السيرفر: ${res.status}`);
      const data = await res.json();
      setStatus(data);
      setStatusError(null);
    } catch (err: any) {
      console.warn("Status fetch error:", err.message);
      setStatusError(err.message);
    }
  };

  // Fetch Global Token Economy Stats (Granted & Deducted from Role Creation)
  const fetchTokenStats = async () => {
    setIsLoadingTokenStats(true);
    try {
      const res = await fetch("/api/token-stats");
      if (res.ok) {
        const data = await res.json();
        if (data.stats) {
          setTokenStats(data.stats);
        }
      }
    } catch (err: any) {
      console.warn("Token stats fetch error:", err.message);
    } finally {
      setIsLoadingTokenStats(false);
    }
  };

  // Fetch Text Channels
  const fetchChannels = async () => {
    setIsLoadingChannels(true);
    try {
      const res = await fetch("/api/channels");
      if (!res.ok) throw new Error(`خطأ ${res.status}`);
      const data = await res.json();
      if (data.channels) {
        setChannels(data.channels);
        if (data.channels.length > 0 && !selectedChannelId) {
          setSelectedChannelId(data.channels[0].id);
        }
      }
    } catch (err: any) {
      console.error("Channels error:", err);
    } finally {
      setIsLoadingChannels(false);
    }
  };

  // Fetch Connected Guilds & Configurations
  const fetchGuilds = async () => {
    setIsLoadingGuilds(true);
    try {
      const res = await fetch("/api/guilds");
      if (!res.ok) throw new Error(`خطأ السيرفر: ${res.status}`);
      const data = await res.json();
      if (data.guilds) {
        setGuilds(data.guilds);
        if (data.guilds.length > 0 && !selectedGuildId) {
          const firstGuild = data.guilds[0];
          setSelectedGuildId(firstGuild.id);
            setConfigForm({
              rolePrice: firstGuild.rolePrice ?? 5000,
              tokenPrice: firstGuild.tokenPrice ?? 10,
              paymentAccount: firstGuild.paymentAccount || "",
              paymentChannelId: firstGuild.paymentChannelId || "",
              allowedRoles: firstGuild.allowedRoles || [],
              freeRoleEnabled: firstGuild.freeRoleEnabled !== false,
              gamesEnabled: firstGuild.gamesEnabled !== false,
              moderationRoles: firstGuild.moderationRoles || { ban: [], kick: [], timeout: [], warn: [], unban: [], untimeout: [], unwarn: [] },
              moderationShortcuts: firstGuild.moderationShortcuts || { ban: "حظر", kick: "طرد", timeout: "تايم", warn: "تحذير", unban: "ازالة حظر", untimeout: "ازالة تايم", unwarn: "ازالة تحذير" },
              logChannels: firstGuild.logChannels || { modLogs: "" },
              confessionChannel: firstGuild.confessionChannel || "",
              confessionPanelChannel: firstGuild.confessionPanelChannel || "",
            });
        }
      }
    } catch (err: any) {
      console.error("Guilds fetch error:", err);
    } finally {
      setIsLoadingGuilds(false);
    }
  };

  // Fetch Discord Roles for selected Guild
  const fetchGuildRoles = async (guildId: string) => {
    if (!guildId) return;
    setIsLoadingRoles(true);
    try {
      const res = await fetch(`/api/guilds/${guildId}/roles`);
      if (res.ok) {
        const data = await res.json();
        setGuildRoles(data.roles || []);
      }
    } catch (err: any) {
      console.error("Roles fetch error:", err);
    } finally {
      setIsLoadingRoles(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    fetchTokenStats();
    const interval = setInterval(() => {
      fetchStatus();
      fetchTokenStats();
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (status?.loggedIn) {
      fetchChannels();
      fetchGuilds();
    }
  }, [status?.loggedIn]);

  useEffect(() => {
    if (selectedGuildId) {
      const current = guilds.find(g => g.id === selectedGuildId);
      if (current) {
        setConfigForm({
          rolePrice: current.rolePrice ?? 5000,
          tokenPrice: current.tokenPrice ?? 10,
          paymentAccount: current.paymentAccount || "",
          paymentChannelId: current.paymentChannelId || "",
          allowedRoles: current.allowedRoles || [],
          freeRoleEnabled: current.freeRoleEnabled !== false,
          gamesEnabled: current.gamesEnabled !== false,
          moderationRoles: current.moderationRoles || { ban: [], kick: [], timeout: [], warn: [], unban: [], untimeout: [], unwarn: [] },
          moderationShortcuts: current.moderationShortcuts || { ban: "حظر", kick: "طرد", timeout: "تايم", warn: "تحذير", unban: "ازالة حظر", untimeout: "ازالة تايم", unwarn: "ازالة تحذير" },
          logChannels: current.logChannels || { modLogs: "" },
          confessionChannel: current.confessionChannel || "",
          confessionPanelChannel: current.confessionPanelChannel || "",
        });
      }
      fetchGuildRoles(selectedGuildId);
    }
  }, [selectedGuildId, guilds]);

  // Handle Quick Feature Toggle (Open / Close)
  const handleToggleFeature = async (guildId: string, feature: "freeRole" | "games", targetState?: boolean) => {
    const currentGuild = guilds.find(g => g.id === guildId);
    const currentVal = feature === "freeRole" 
      ? (currentGuild?.freeRoleEnabled !== false)
      : (currentGuild?.gamesEnabled !== false);
    const nextVal = targetState !== undefined ? targetState : !currentVal;

    setIsTogglingFeature(`${guildId}-${feature}`);
    try {
      const res = await fetch("/api/guilds/toggle-feature", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guildId,
          feature,
          enabled: nextVal
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "فشل التحديث.");

      // Optimistic update in UI
      setGuilds(prev => prev.map(g => {
        if (g.id === guildId) {
          return {
            ...g,
            [feature === "freeRole" ? "freeRoleEnabled" : "gamesEnabled"]: nextVal
          };
        }
        return g;
      }));

      if (selectedGuildId === guildId) {
        setConfigForm(prev => ({
          ...prev,
          [feature === "freeRole" ? "freeRoleEnabled" : "gamesEnabled"]: nextVal
        }));
      }

      const featureName = feature === "freeRole" ? "صناعة الرول المجاني" : "قائمة ونظام الألعاب";
      setConfigStatusMsg({ 
        type: "success", 
        text: `🎉 تم ${nextVal ? "فتح وتفعيل" : "إغلاق وتعطيل"} ${featureName} بنجاح!` 
      });
    } catch (err: any) {
      setConfigStatusMsg({ type: "error", text: `❌ خطأ في تغيير الحالة: ${err.message}` });
    } finally {
      setIsTogglingFeature(null);
    }
  };

  // Handle 1-Click Creation of all 22 Arab Country Roles
  const handleCreateArabRoles = async () => {
    if (!selectedGuildId) return;
    setIsCreatingArabRoles(true);
    setArabRolesSuccessMsg(null);
    try {
      const res = await fetch(`/api/guilds/${selectedGuildId}/create-arab-roles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ style: "space", autoSetup: true })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "فشل إنشاء رتب الدول العربية.");
      setArabRolesSuccessMsg(data.message || "تم إنشاء وتجهيز رتب 22 دولة عربية بنجاح!");
      await fetchGuildRoles(selectedGuildId);
      await fetchGuilds();
      setTimeout(() => setArabRolesSuccessMsg(null), 8000);
    } catch (err: any) {
      alert("❌ حدث خطأ: " + err.message);
    } finally {
      setIsCreatingArabRoles(false);
    }
  };

  // Handle Live Config Save
  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGuildId) {
      setConfigStatusMsg({ type: "error", text: "⚠️ يرجى اختيار السيرفر أولاً." });
      return;
    }

    setIsSavingConfig(true);
    setConfigStatusMsg(null);

    try {
      const res = await fetch("/api/guilds/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guildId: selectedGuildId,
          ...configForm
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "فشل التحديث.");

      setConfigStatusMsg({ type: "success", text: "🎉 تم حفظ الإعدادات وتطبيقها فوراً على السيرفر!" });
      fetchGuilds();
    } catch (err: any) {
      setConfigStatusMsg({ type: "error", text: `❌ خطأ في الحفظ: ${err.message}` });
    } finally {
      setIsSavingConfig(false);
    }
  };

  // Handle Instant Feature Toggle (Saves directly to server)
  const handleInstantToggleFeature = async (feature: "freeRole" | "games", newValue: boolean) => {
    if (!selectedGuildId) {
      setConfigStatusMsg({ type: "error", text: "⚠️ يرجى اختيار السيرفر أولاً." });
      return;
    }

    // Optimistic UI update
    if (feature === "freeRole") {
      setConfigForm(prev => ({ ...prev, freeRoleEnabled: newValue }));
    } else if (feature === "games") {
      setConfigForm(prev => ({ ...prev, gamesEnabled: newValue }));
    }

    try {
      const res = await fetch("/api/guilds/toggle-feature", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guildId: selectedGuildId,
          feature,
          enabled: newValue
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "فشل التبديل.");

      setConfigStatusMsg({ 
        type: "success", 
        text: `⚡ ${data.message || "تم حفظ وتطبيق التعديل مباشرة على السيرفر!"}` 
      });
      fetchGuilds();
    } catch (err: any) {
      setConfigStatusMsg({ type: "error", text: `❌ فشل التبديل: ${err.message}` });
      // Revert if failed
      if (feature === "freeRole") {
        setConfigForm(prev => ({ ...prev, freeRoleEnabled: !newValue }));
      } else if (feature === "games") {
        setConfigForm(prev => ({ ...prev, gamesEnabled: !newValue }));
      }
    }
  };

  // Handle Send Message
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedChannelId) {
      setChatNotice({ type: "error", text: "⚠️ يرجى تحديد قناة ديسكورد أولاً." });
      return;
    }
    if (!messageText.trim()) {
      setChatNotice({ type: "error", text: "⚠️ النص فارغ." });
      return;
    }

    setIsSendingMsg(true);
    setChatNotice(null);

    try {
      const res = await fetch("/api/send-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId: selectedChannelId, message: messageText })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "خطأ في الإرسال.");

      setChatNotice({ type: "success", text: "🎉 تم إرسال الرسالة إلى القناة بنجاح!" });
      setMessageText("");
    } catch (err: any) {
      setChatNotice({ type: "error", text: `❌ فشل الإرسال: ${err.message}` });
    } finally {
      setIsSendingMsg(false);
    }
  };

  // Handle Game Trigger
  const handleGameAction = async (action: string, gameType?: string) => {
    if (!selectedChannelId) {
      setGameNotice({ type: "error", text: "⚠️ يرجى تحديد القناة المستهدفة أولاً." });
      return;
    }

    setIsGameActionPending(true);
    setGameNotice(null);

    try {
      const res = await fetch("/api/games/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId: selectedChannelId, action, gameType })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "حدث خطأ غير متوقع.");

      setGameNotice({ type: "success", text: data.message || "🎉 تم تنفيذ الإجراء بنجاح!" });
    } catch (err: any) {
      setGameNotice({ type: "error", text: `❌ فشل الإجراء: ${err.message}` });
    } finally {
      setIsGameActionPending(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(text);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-violet-500 selection:text-white relative overflow-x-hidden" dir="rtl">
      
      {/* Dynamic Background Glow Orbs */}
      <div className="absolute top-0 right-1/4 w-[500px] h-[500px] bg-violet-600/15 rounded-full blur-[140px] pointer-events-none -z-10" />
      <div className="absolute top-1/3 left-1/4 w-[600px] h-[600px] bg-cyan-600/10 rounded-full blur-[160px] pointer-events-none -z-10" />

      {/* Top Main Navigation Header */}
      <header className="border-b border-slate-800/80 bg-slate-900/80 backdrop-blur-xl sticky top-0 z-50 shadow-lg shadow-black/20">
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-3.5 flex flex-col md:flex-row items-center justify-between gap-4">
          
          {/* Logo & Status Indicator */}
          <div className="flex items-center gap-3.5 w-full md:w-auto justify-between md:justify-start">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 bg-gradient-to-tr from-violet-600 via-indigo-500 to-cyan-400 rounded-2xl flex items-center justify-center shadow-lg shadow-violet-500/30 shrink-0">
                <Bot size={26} className="text-white drop-shadow-md" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-lg font-bold tracking-tight text-white bg-gradient-to-r from-white via-slate-100 to-slate-300 bg-clip-text text-transparent">
                    RoleMaster Control Hub
                  </h1>
                  <span className="text-[10px] font-mono px-2 py-0.5 bg-violet-500/15 text-violet-300 border border-violet-500/30 rounded-full font-semibold">
                    v2.5 Cyber
                  </span>
                </div>
                <p className="text-slate-400 text-xs">منصة التحكم وإدارة الرتب والألعاب التفاعلية</p>
              </div>
            </div>

            {/* Connection Status Pill */}
            <div className="flex items-center gap-2">
              {status?.loggedIn ? (
                <div className="flex items-center gap-2 px-3.5 py-1.5 bg-emerald-500/10 text-emerald-400 text-xs font-semibold rounded-full border border-emerald-500/30 shadow-inner">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shadow-sm shadow-emerald-400"></span>
                  <span>{status.tag}</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 px-3.5 py-1.5 bg-amber-500/10 text-amber-400 text-xs font-semibold rounded-full border border-amber-500/30">
                  <Zap size={13} className="animate-spin text-amber-400" />
                  <span>جاري الاتصال...</span>
                </div>
              )}
            </div>
          </div>

          {/* Action Bar */}
          <div className="flex items-center gap-3 w-full md:w-auto justify-end">
            <button
              onClick={() => { fetchStatus(); fetchChannels(); fetchGuilds(); }}
              className="p-2.5 bg-slate-800/90 hover:bg-slate-750 text-slate-200 rounded-xl transition-all border border-slate-700/80 hover:border-violet-500/40 shadow-sm cursor-pointer"
              title="تحديث البيانات المباشرة"
            >
              <RefreshCw size={16} />
            </button>

            <a
              href={inviteUrl}
              target="_blank"
              rel="noreferrer"
              className="px-5 py-2.5 bg-gradient-to-r from-violet-600 via-indigo-600 to-cyan-600 hover:from-violet-500 hover:to-cyan-500 text-white font-semibold text-xs rounded-xl transition-all shadow-lg shadow-violet-600/25 flex items-center gap-2 cursor-pointer"
            >
              <span>دعوة البوت للسيرفر</span>
              <ExternalLink size={14} />
            </a>
          </div>
        </div>

        {/* Navigation Tabs Bar */}
        <div className="max-w-7xl mx-auto px-4 md:px-8 border-t border-slate-800/70 flex items-center gap-1.5 overflow-x-auto scrollbar-none py-2.5">
          {[
            { id: "overview", label: "المراقبة والمؤشرات", icon: Activity },
            { id: "config", label: "تعديل إعدادات السيرفر", icon: Sliders },
            { id: "mod", label: "قسم الإدارة", icon: Shield },
            { id: "logs", label: "سجلات الإدارة", icon: Clock },
            { id: "messages", label: "لوحة الرسائل والإعلانات", icon: MessageSquare },
            { id: "games", label: "صالون الألعاب التفاعلية", icon: Gamepad2 },
            { id: "manual", label: "دليل الأوامر والشرح", icon: HelpCircle }
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer select-none ${
                  isActive
                    ? "bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-md shadow-violet-600/30 border border-violet-400/30"
                    : "text-slate-400 hover:text-slate-100 hover:bg-slate-800/60"
                }`}
              >
                <Icon size={15} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </header>

      {/* Main Content Workspace */}
      <main className="max-w-7xl mx-auto px-4 md:px-8 py-7 space-y-7">

        {/* Global Connection Error Notice if present */}
        {(statusError || (status && !status.loggedIn && status.lastError)) && (
          <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-2xl flex items-center gap-3 text-rose-400 text-xs shadow-lg">
            <AlertTriangle size={18} className="shrink-0" />
            <span>
              {status?.lastError 
                ? `خطأ اتصال البوت بـ Discord: ${status.lastError}. تأكد من تفعيل الـ Privileged Gateway Intents (Server Members & Message Content) وتحديث التوكن.`
                : `تنبيه: تعذر استرداد حالة البوت المباشرة. تأكد من أن سيرفر ديسكورد متصل وقيد التشغيل. (${statusError})`}
            </span>
          </div>
        )}

        {/* TAB 1: OVERVIEW & MONITORING */}
        {activeTab === "overview" && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-7">
            
            {/* KPI Cards Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between shadow-lg shadow-black/20 hover:border-violet-500/30 transition-all">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-xs font-bold text-slate-300">حالة الاتصال المباشر</span>
                  <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                    <Radio size={16} />
                  </div>
                </div>
                <div className="mt-4">
                  <div className="text-2xl font-bold text-white tracking-tight">
                    {status?.loggedIn ? "متصل وقيد العمل" : "غير متصل"}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">{status?.tag || "لا يوجد حساب مسجل"}</p>
                </div>
              </div>

              <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between shadow-lg shadow-black/20 hover:border-violet-500/30 transition-all">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-xs font-bold text-slate-300">السيرفرات المربوطة</span>
                  <div className="w-8 h-8 rounded-xl bg-violet-500/10 text-violet-400 flex items-center justify-center">
                    <Server size={16} />
                  </div>
                </div>
                <div className="mt-4">
                  <div className="text-2xl font-bold text-white tracking-tight">
                    {status?.guilds ?? 0} <span className="text-xs font-normal text-slate-400">سيرفر</span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">جاهز لاستقبال أوامر الأعضاء</p>
                </div>
              </div>

              <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between shadow-lg shadow-black/20 hover:border-cyan-500/30 transition-all">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-xs font-bold text-slate-300">صناعة الرول المجاني</span>
                  <div className="w-8 h-8 rounded-xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center">
                    <Award size={16} />
                  </div>
                </div>
                <div className="mt-4">
                  {selectedGuildId ? (
                    <div className="text-xl font-bold tracking-tight">
                      {guilds.find(g => g.id === selectedGuildId)?.freeRoleEnabled !== false ? (
                        <span className="text-emerald-400">مفتوح 🟢 (مجاني)</span>
                      ) : (
                        <span className="text-rose-400">مغلق 🔒</span>
                      )}
                    </div>
                  ) : (
                    <div className="text-xl font-bold text-cyan-400 tracking-tight">تحكم متاح</div>
                  )}
                  <p className="text-[11px] text-slate-400 mt-1">يمكن فتحه أو إغلاقه بنقرة زر</p>
                </div>
              </div>

              <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between shadow-lg shadow-black/20 hover:border-purple-500/30 transition-all">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-xs font-bold text-slate-300">قائمة الألعاب التفاعلية</span>
                  <div className="w-8 h-8 rounded-xl bg-purple-500/10 text-purple-400 flex items-center justify-center">
                    <Gamepad2 size={16} />
                  </div>
                </div>
                <div className="mt-4">
                  {selectedGuildId ? (
                    <div className="text-xl font-bold tracking-tight">
                      {guilds.find(g => g.id === selectedGuildId)?.gamesEnabled !== false ? (
                        <span className="text-emerald-400">مفتوحة 🟢</span>
                      ) : (
                        <span className="text-rose-400">مغلقة 🔒</span>
                      )}
                    </div>
                  ) : (
                    <div className="text-xl font-bold text-purple-400 tracking-tight">جاهزة للعمل</div>
                  )}
                  <p className="text-[11px] text-slate-400 mt-1">XO، روليت، مافيا، من الكاذب</p>
                </div>
              </div>
            </div>

            {/* Global Token Economy Live Counters Grid */}
            <div className="bg-gradient-to-br from-slate-900/95 via-slate-900/90 to-indigo-950/40 border border-slate-800/90 rounded-3xl p-6 shadow-2xl shadow-black/40 space-y-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-amber-500/15 text-amber-400 border border-amber-500/20 flex items-center justify-center font-bold">
                    <Coins size={22} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-bold text-white tracking-tight">عداد واقتصاد التوكنات العالمي</h2>
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-300 border border-amber-500/20 flex items-center gap-1">
                        <Sparkles size={10} />
                        <span>مباشر & عالمي</span>
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      إحصائيات فورية لحركة التوكنات الممنوحة للأعضاء مقابل التوكنات المستهلكة والمسحوبة عند صناعة الرتب
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={fetchTokenStats}
                  disabled={isLoadingTokenStats}
                  className="px-3.5 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-800 text-slate-200 text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer border border-slate-700 disabled:opacity-50"
                >
                  <RefreshCw size={14} className={isLoadingTokenStats ? "animate-spin text-amber-400" : ""} />
                  <span>{isLoadingTokenStats ? "جاري التحديث..." : "تحديث العداد"}</span>
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                {/* 1. Global Granted Tokens Counter */}
                <div className="bg-gradient-to-br from-amber-950/30 via-slate-900/90 to-slate-900 border border-amber-500/30 rounded-2xl p-5 flex flex-col justify-between space-y-4 hover:border-amber-500/50 transition-all shadow-lg shadow-amber-950/20">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center">
                        <ArrowUpRight size={18} />
                      </div>
                      <div>
                        <span className="text-xs font-bold text-amber-200 block">التوكنات الممنوحة عالمياً</span>
                        <span className="text-[10px] text-slate-400">من التفاعل والرسائل والنشاط</span>
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/20">
                      + مكتسبة
                    </span>
                  </div>

                  <div className="space-y-1">
                    <div className="text-3xl font-black text-amber-400 tracking-tight flex items-baseline gap-1.5">
                      <span>{tokenStats?.totalGranted?.toLocaleString() ?? 0}</span>
                      <span className="text-sm font-semibold text-slate-400">توكن</span>
                    </div>
                    <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
                      <TrendingUp size={13} className="text-emerald-400" />
                      <span>تمنح تلقائياً عند تفاعل الأعضاء في الشات بمعدل 1 توكن/دقيقة</span>
                    </p>
                  </div>
                </div>

                {/* 2. Tokens Spent on Role Creation Counter */}
                <div className="bg-gradient-to-br from-violet-950/30 via-slate-900/90 to-slate-900 border border-violet-500/30 rounded-2xl p-5 flex flex-col justify-between space-y-4 hover:border-violet-500/50 transition-all shadow-lg shadow-violet-950/20">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-xl bg-violet-500/20 text-violet-400 flex items-center justify-center">
                        <ArrowDownRight size={18} />
                      </div>
                      <div>
                        <span className="text-xs font-bold text-violet-200 block">التوكنات المسحوبة من الرتب</span>
                        <span className="text-[10px] text-slate-400">المستهلكة في عمليات صناعة الرول</span>
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-violet-500/15 text-violet-300 border border-violet-500/20">
                      - مسحوبة
                    </span>
                  </div>

                  <div className="space-y-1">
                    <div className="text-3xl font-black text-violet-400 tracking-tight flex items-baseline gap-1.5">
                      <span>{tokenStats?.totalSpentOnRoles?.toLocaleString() ?? 0}</span>
                      <span className="text-sm font-semibold text-slate-400">توكن</span>
                    </div>
                    <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
                      <Zap size={13} className="text-violet-400" />
                      <span>
                        {tokenStats?.rolesCreatedWithTokensCount ?? 0} عملية صناعة رتبة تمت بنجاح عبر التوكنات
                      </span>
                    </p>
                  </div>
                </div>

                {/* 3. Circulating Token Supply Counter */}
                <div className="bg-gradient-to-br from-cyan-950/30 via-slate-900/90 to-slate-900 border border-cyan-500/30 rounded-2xl p-5 flex flex-col justify-between space-y-4 hover:border-cyan-500/50 transition-all shadow-lg shadow-cyan-950/20">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-xl bg-cyan-500/20 text-cyan-400 flex items-center justify-center">
                        <Wallet size={18} />
                      </div>
                      <div>
                        <span className="text-xs font-bold text-cyan-200 block">صافي التوكنات المتداولة</span>
                        <span className="text-[10px] text-slate-400">الأرصدة الحالية في محافظ الأعضاء</span>
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-cyan-500/15 text-cyan-300 border border-cyan-500/20">
                      متداول 💎
                    </span>
                  </div>

                  <div className="space-y-1">
                    <div className="text-3xl font-black text-cyan-400 tracking-tight flex items-baseline gap-1.5">
                      <span>{tokenStats?.circulatingTokens?.toLocaleString() ?? 0}</span>
                      <span className="text-sm font-semibold text-slate-400">توكن</span>
                    </div>
                    <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
                      <Users size={13} className="text-cyan-400" />
                      <span>موزعة عبر {tokenStats?.totalUsersWithTokens ?? 0} عضو يمتلك رصيداً نشطاً</span>
                    </p>
                  </div>
                </div>
              </div>

              {/* Progress / Ratio Bar */}
              {tokenStats && (tokenStats.totalGranted > 0 || tokenStats.totalSpentOnRoles > 0) && (
                <div className="pt-2 border-t border-slate-800/80 space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>معدل استهلاك التوكنات في صناعة الرتب:</span>
                    <span className="font-bold text-white">
                      {tokenStats.totalGranted > 0 
                        ? `${((tokenStats.totalSpentOnRoles / tokenStats.totalGranted) * 100).toFixed(1)}%` 
                        : "0%"}
                    </span>
                  </div>
                  <div className="w-full bg-slate-950 rounded-full h-2.5 overflow-hidden flex border border-slate-800">
                    <div 
                      className="bg-violet-500 h-full transition-all duration-500" 
                      style={{ 
                        width: `${Math.min(100, Math.max(0, tokenStats.totalGranted > 0 ? (tokenStats.totalSpentOnRoles / tokenStats.totalGranted) * 100 : 0))}%` 
                      }}
                      title="توكنات مستهلكة في صناعة الرتب"
                    />
                    <div 
                      className="bg-amber-500/80 h-full transition-all duration-500 flex-1"
                      title="توكنات متبقية بحوزة الأعضاء"
                    />
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-violet-500 inline-block"/> مسحوبة لصناعة الرول ({tokenStats.totalSpentOnRoles.toLocaleString()})</span>
                    <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block"/> متداولة ومتاحة للأعضاء ({tokenStats.circulatingTokens.toLocaleString()})</span>
                  </div>
                </div>
              )}
            </div>

            {/* Quick Feature Toggle Control Bar */}
            {selectedGuildId && (
              <div className="bg-slate-900/95 border border-slate-800 rounded-3xl p-6 shadow-xl shadow-black/30 space-y-4">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-violet-500/15 text-violet-400 flex items-center justify-center font-bold">
                      <Sliders size={18} />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-white">التحكم السريع بالميزات للسيرفر المحدد:</h3>
                      <p className="text-[11px] text-slate-400">{guilds.find(g => g.id === selectedGuildId)?.name || selectedGuildId}</p>
                    </div>
                  </div>

                  <select
                    value={selectedGuildId}
                    onChange={(e) => setSelectedGuildId(e.target.value)}
                    className="bg-slate-950 border border-slate-750 text-white rounded-xl px-3.5 py-2 text-xs focus:outline-none focus:border-violet-500 cursor-pointer"
                  >
                    {guilds.map(g => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                  {/* Free Role Toggle Card */}
                  {(() => {
                    const currentGuild = guilds.find(g => g.id === selectedGuildId);
                    const isFreeRoleOn = currentGuild?.freeRoleEnabled !== false;
                    const isToggling = isTogglingFeature === `${selectedGuildId}-freeRole`;

                    return (
                      <div className={`p-4 rounded-2xl border transition-all flex flex-col justify-between space-y-3 ${
                        isFreeRoleOn 
                          ? "bg-emerald-950/20 border-emerald-500/30" 
                          : "bg-rose-950/20 border-rose-500/30"
                      }`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2.5">
                            <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${
                              isFreeRoleOn ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400"
                            }`}>
                              <Award size={18} />
                            </div>
                            <div>
                              <span className="text-xs font-bold text-white block">صناعة الرول المجاني</span>
                              <span className="text-[10px] text-slate-400">
                                {isFreeRoleOn ? "متاح للأعضاء (0 كريدت / 0 توكن)" : "معطل (يتطلب الدفع بالكريدت أو التوكنات)"}
                              </span>
                            </div>
                          </div>
                          <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                            isFreeRoleOn ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30" : "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                          }`}>
                            {isFreeRoleOn ? "مفتوح 🟢" : "مغلق 🔴"}
                          </span>
                        </div>

                        <div className="pt-1 flex items-center justify-end">
                          <button
                            type="button"
                            disabled={isToggling}
                            onClick={() => handleToggleFeature(selectedGuildId, "freeRole", !isFreeRoleOn)}
                            className={`px-4 py-2 text-xs font-bold rounded-xl transition-all flex items-center gap-2 cursor-pointer shadow-md disabled:opacity-50 ${
                              isFreeRoleOn
                                ? "bg-rose-600/90 hover:bg-rose-500 text-white shadow-rose-600/20"
                                : "bg-emerald-600/90 hover:bg-emerald-500 text-white shadow-emerald-600/20"
                            }`}
                          >
                            <Power size={14} />
                            <span>
                              {isToggling ? "جاري التحديث..." : isFreeRoleOn ? "إغلاق صناعة الرول المجاني" : "فتح صناعة الرول المجاني"}
                            </span>
                          </button>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Games Toggle Card */}
                  {(() => {
                    const currentGuild = guilds.find(g => g.id === selectedGuildId);
                    const isGamesOn = currentGuild?.gamesEnabled !== false;
                    const isToggling = isTogglingFeature === `${selectedGuildId}-games`;

                    return (
                      <div className={`p-4 rounded-2xl border transition-all flex flex-col justify-between space-y-3 ${
                        isGamesOn 
                          ? "bg-purple-950/20 border-purple-500/30" 
                          : "bg-rose-950/20 border-rose-500/30"
                      }`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2.5">
                            <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${
                              isGamesOn ? "bg-purple-500/20 text-purple-400" : "bg-rose-500/20 text-rose-400"
                            }`}>
                              <Gamepad2 size={18} />
                            </div>
                            <div>
                              <span className="text-xs font-bold text-white block">قائمة ونظام الألعاب</span>
                              <span className="text-[10px] text-slate-400">
                                {isGamesOn ? "مفتوح ويعمل لجميع أوامر الألعاب" : "مغلق ومعطل ولن يستجيب لأوامر الألعاب"}
                              </span>
                            </div>
                          </div>
                          <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                            isGamesOn ? "bg-purple-500/20 text-purple-300 border border-purple-500/30" : "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                          }`}>
                            {isGamesOn ? "مفتوحة 🟢" : "مغلقة 🔴"}
                          </span>
                        </div>

                        <div className="pt-1 flex items-center justify-end">
                          <button
                            type="button"
                            disabled={isToggling}
                            onClick={() => handleToggleFeature(selectedGuildId, "games", !isGamesOn)}
                            className={`px-4 py-2 text-xs font-bold rounded-xl transition-all flex items-center gap-2 cursor-pointer shadow-md disabled:opacity-50 ${
                              isGamesOn
                                ? "bg-rose-600/90 hover:bg-rose-500 text-white shadow-rose-600/20"
                                : "bg-purple-600/90 hover:bg-purple-500 text-white shadow-purple-600/20"
                            }`}
                          >
                            <Power size={14} />
                            <span>
                              {isToggling ? "جاري التحديث..." : isGamesOn ? "إغلاق قائمة الألعاب" : "فتح قائمة الألعاب"}
                            </span>
                          </button>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}

            {/* Main Feature Cards */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* Bot Capabilities Summary */}
              <div className="lg:col-span-7 bg-slate-900/90 border border-slate-800 rounded-3xl p-6 md:p-7 flex flex-col justify-between space-y-6 shadow-xl shadow-black/30">
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="px-3 py-1 bg-violet-500/15 text-violet-300 text-[10px] font-bold uppercase tracking-wider rounded-md border border-violet-500/30">
                      نظام التحكم المباشر بالرتب
                    </span>
                  </div>
                  <h2 className="text-xl font-bold text-white leading-snug">
                    إدارة تلقائية وسريعة للرتب والفعاليات
                  </h2>
                  <p className="text-slate-400 text-xs mt-2.5 leading-relaxed">
                    يعمل البوت كمنظومة متكاملة تتيح للمستخدمين إنشاء الرتب الخاصة (`صنع رول`)، اختيار طرق الدفع المتاحة (كريدت، توكنات، أو التجربة المجانية 0)، وتوفير ألعاب تفاعلية فورية بدون تعقيد.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div className="bg-slate-950/80 p-4 rounded-2xl border border-slate-800/90 space-y-1 hover:border-violet-500/30 transition-all">
                    <span className="text-xs font-bold text-violet-300 block">أمر صنع رتبة خاصة</span>
                    <p className="text-[11px] text-slate-400">`صنع رول` - يفتح غرفة خاصة لاختيار طريقة الدفع</p>
                  </div>
                  <div className="bg-slate-950/80 p-4 rounded-2xl border border-slate-800/90 space-y-1 hover:border-emerald-500/30 transition-all">
                    <span className="text-xs font-bold text-emerald-300 block">أوامر التحكم بالرتب</span>
                    <p className="text-[11px] text-slate-400">`إضافة رول` و `نزع رول` لاختيار وإزالتها</p>
                  </div>
                  <div className="bg-slate-950/80 p-4 rounded-2xl border border-slate-800/90 space-y-1 hover:border-cyan-500/30 transition-all">
                    <span className="text-xs font-bold text-cyan-300 block">نظام توكنات التفاعل</span>
                    <p className="text-[11px] text-slate-400">`رصيدي` لمعرفة التوكنات المكتسبة من الدردشة والألعاب</p>
                  </div>
                  <div className="bg-slate-950/80 p-4 rounded-2xl border border-slate-800/90 space-y-1 hover:border-purple-500/30 transition-all">
                    <span className="text-xs font-bold text-purple-300 block">صالون الألعاب التفاعلي</span>
                    <p className="text-[11px] text-slate-400">ألعاب XO، روليت، مافيا، ومن الكاذب؟ مع حذف التنبيه الآلي</p>
                  </div>
                </div>
              </div>

              {/* Bot Active Servers Summary */}
              <div className="lg:col-span-5 bg-slate-900/90 border border-slate-800 rounded-3xl p-6 md:p-7 flex flex-col justify-between shadow-xl shadow-black/30">
                <div>
                  <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-800">
                    <div className="flex items-center gap-2">
                      <Server size={18} className="text-violet-400" />
                      <h3 className="text-sm font-bold text-white">السيرفرات النشطة المتصلة</h3>
                    </div>
                    <span className="text-xs font-mono text-slate-400 bg-slate-800 px-2.5 py-0.5 rounded-full">{guilds.length} سيرفر</span>
                  </div>

                  <div className="space-y-3 overflow-y-auto max-h-64 pr-1">
                    {guilds.length > 0 ? (
                      guilds.map(g => (
                        <div key={g.id} className="p-3 bg-slate-950/80 rounded-2xl border border-slate-800 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            {g.icon ? (
                              <img src={g.icon} alt={g.name} className="w-9 h-9 rounded-xl object-cover ring-1 ring-slate-700" />
                            ) : (
                              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-700 flex items-center justify-center text-xs font-bold text-white shadow-sm">
                                {g.name.slice(0, 2)}
                              </div>
                            )}
                            <div>
                              <span className="text-xs font-bold text-white block">{g.name}</span>
                              <span className="text-[10px] text-slate-400">{g.memberCount} عضو</span>
                            </div>
                          </div>
                          <button
                            onClick={() => { setSelectedGuildId(g.id); setActiveTab("config"); }}
                            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] rounded-xl transition-all border border-slate-700/60 cursor-pointer"
                          >
                            تعديل الإعدادات
                          </button>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-8 text-slate-500 text-xs">
                        جاري تحميل بيانات السيرفرات أو لا توجد سيرفرات متصلة بعد...
                      </div>
                    )}
                  </div>
                </div>

                <p className="mt-4 pt-3 text-[11px] text-slate-500 text-center border-t border-slate-800/60">
                  يمكنك تخصيص أسعار وطرق دفع كل سيرفر بشكل مستقل من تبويب الإعدادات.
                </p>
              </div>

            </div>
          </motion.div>
        )}

        {/* TAB 2: GUILD CONFIG & LIVE EDITING */}
        {activeTab === "config" && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
            
            {/* Server Selector Bar */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 md:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-lg">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-violet-500/10 text-violet-400 rounded-xl flex items-center justify-center">
                  <Sliders size={20} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">اختر السيرفر للتعديل المباشر</h3>
                  <p className="text-[11px] text-slate-400">حدد السيرفر المراد تخصيص أسعاره وحسابات الدفع فيه</p>
                </div>
              </div>

              <select
                value={selectedGuildId}
                onChange={(e) => setSelectedGuildId(e.target.value)}
                className="bg-slate-950 border border-slate-750 text-white rounded-xl px-4 py-2.5 text-xs focus:outline-none focus:border-violet-500 cursor-pointer w-full sm:w-64 font-medium"
              >
                {guilds.map(g => (
                  <option key={g.id} value={g.id}>{g.name} ({g.id})</option>
                ))}
              </select>
            </div>

            {selectedGuildId ? (
              <form onSubmit={handleSaveConfig} className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                
                {/* Form Inputs Panel */}
                <div className="lg:col-span-8 bg-slate-900/90 border border-slate-800 rounded-3xl p-6 md:p-8 space-y-6 shadow-xl shadow-black/30">
                  <div className="pb-4 border-b border-slate-800">
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      <CreditCard size={18} className="text-emerald-400" />
                      <span>إعدادات أسعار الكريدت والتوكنات للرتب الخاصة</span>
                    </h3>
                    <p className="text-xs text-slate-400 mt-1">
                      هذه الإعدادات تطبق فوراً عندما يقوم الأعضاء بكتابة أمر <code className="text-violet-300 font-mono bg-violet-500/10 px-1.5 py-0.5 rounded">صنع رول</code>.
                    </p>
                  </div>

                  {/* Feature Switches Section (Direct Toggles) */}
                  <div className="bg-slate-950/80 border border-slate-800/80 rounded-2xl p-5 space-y-4">
                    <div className="flex items-center gap-2 text-white font-bold text-xs">
                      <Sliders size={16} className="text-violet-400" />
                      <span>مفاتيح تفعيل وتعطيل الميزات المباشرة:</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {/* Free Role Switch */}
                      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 flex flex-col justify-between space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Award size={16} className="text-cyan-400" />
                            <span className="text-xs font-bold text-white">صناعة الرول مجاناً</span>
                          </div>
                          <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                            configForm.freeRoleEnabled !== false 
                              ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30" 
                              : "bg-rose-500/15 text-rose-300 border border-rose-500/30"
                          }`}>
                            {configForm.freeRoleEnabled !== false ? "مفتوح 🟢" : "مغلق 🔴"}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400">
                          {configForm.freeRoleEnabled !== false 
                            ? "يظهر خيار (0 مجاناً) في الديسكورد عند كتابة صنع رول."
                            : "مغلق، سيطلب البوت الكريدت أو التوكنات فقط."}
                        </p>
                        <button
                          type="button"
                          onClick={() => handleInstantToggleFeature("freeRole", configForm.freeRoleEnabled === false)}
                          className={`w-full py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer border ${
                            configForm.freeRoleEnabled !== false
                              ? "bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border-rose-500/30"
                              : "bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                          }`}
                        >
                          {configForm.freeRoleEnabled !== false ? "إغلاق الخيار المجاني 🔒 (حفظ فوري)" : "فتح الخيار المجاني 🎁 (حفظ فوري)"}
                        </button>
                      </div>

                      {/* Games Switch */}
                      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 flex flex-col justify-between space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Gamepad2 size={16} className="text-purple-400" />
                            <span className="text-xs font-bold text-white">قائمة ونظام الألعاب</span>
                          </div>
                          <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                            configForm.gamesEnabled !== false 
                              ? "bg-purple-500/15 text-purple-300 border border-purple-500/30" 
                              : "bg-rose-500/15 text-rose-300 border border-rose-500/30"
                          }`}>
                            {configForm.gamesEnabled !== false ? "مفتوحة 🟢" : "مغلقة 🔴"}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400">
                          {configForm.gamesEnabled !== false 
                            ? "جميع أوامر وكونسول الألعاب نشطة ومتاحة للأعضاء."
                            : "معطلة بالكامل، البوت صامت ولن يرسل أي رسائل أو ردود ألعاب نهائياً."}
                        </p>
                        <button
                          type="button"
                          onClick={() => handleInstantToggleFeature("games", configForm.gamesEnabled === false)}
                          className={`w-full py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer border ${
                            configForm.gamesEnabled !== false
                              ? "bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border-rose-500/30"
                              : "bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 border-purple-500/30"
                          }`}
                        >
                          {configForm.gamesEnabled !== false ? "إغلاق قائمة الألعاب 🔒 (حفظ فوري)" : "فتح قائمة الألعاب 🎮 (حفظ فوري)"}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    {/* Role Credit Price */}
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-300 block">سعر الكريدت (Credit Price):</label>
                      <input
                        type="number"
                        value={configForm.rolePrice}
                        onChange={(e) => setConfigForm({ ...configForm, rolePrice: Number(e.target.value) })}
                        placeholder="5000"
                        className="w-full bg-slate-950/90 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-violet-500 transition-all"
                      />
                      <span className="text-[10px] text-slate-500 block">المبلغ المطلوب بالكريدت (مثال: 5000)</span>
                    </div>

                    {/* Role Token Price */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-slate-300 block">سعر التوكنات (Token Price):</label>
                        {tokenStats && (
                          <span className="text-[10px] text-amber-400 font-semibold bg-amber-500/10 px-2 py-0.5 rounded-md border border-amber-500/20">
                            المسحوب عالمياً: {tokenStats.totalSpentOnRoles.toLocaleString()} توكن
                          </span>
                        )}
                      </div>
                      <input
                        type="number"
                        value={configForm.tokenPrice}
                        onChange={(e) => setConfigForm({ ...configForm, tokenPrice: Number(e.target.value) })}
                        placeholder="10"
                        className="w-full bg-slate-950/90 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-violet-500 transition-all"
                      />
                      <span className="text-[10px] text-slate-500 block">عدد توكنات التفاعل المطلوبة لإنشاء الرتبة (مثال: 10)</span>
                    </div>

                    {/* Payment Account */}
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-300 block">حساب الاستلام (ProBot / Owner User ID):</label>
                      <input
                        type="text"
                        value={configForm.paymentAccount}
                        onChange={(e) => setConfigForm({ ...configForm, paymentAccount: e.target.value })}
                        placeholder="مثال: 123456789012345678"
                        className="w-full bg-slate-950/90 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-violet-500 transition-all"
                      />
                      <span className="text-[10px] text-slate-500 block">المعرف الفريد للشخص المعين لاستلام التحويل</span>
                    </div>

                    {/* Payment Channel ID */}
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-300 block">غرفة إثبات الدفع (Payment Channel ID):</label>
                      <select
                        value={configForm.paymentChannelId}
                        onChange={(e) => setConfigForm({ ...configForm, paymentChannelId: e.target.value })}
                        className="w-full bg-slate-950/90 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-violet-500 cursor-pointer transition-all"
                      >
                        <option value="">-- اختر قناة إثبات التحويل --</option>
                        {channels
                          .filter(c => !selectedGuildId || c.guildId === selectedGuildId)
                          .map(c => (
                            <option key={c.id} value={c.id}>#{c.name} [{c.guildName}]</option>
                          ))}
                      </select>
                      <span className="text-[10px] text-slate-500 block">القناة المحددة للتحقق من رسائل تحويل الكريدت</span>
                    </div>
                  </div>

                  {/* Feedback Message */}
                  {configStatusMsg && (
                    <div className={`p-3.5 rounded-xl text-xs font-semibold ${
                      configStatusMsg.type === "success" 
                        ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                        : "bg-rose-500/10 text-rose-400 border border-rose-500/30"
                    }`}>
                      {configStatusMsg.text}
                    </div>
                  )}

                  {/* Submit Button */}
                  <div className="flex justify-end pt-2">
                    <button
                      type="submit"
                      disabled={isSavingConfig}
                      className="px-6 py-2.5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-semibold text-xs rounded-xl transition-all shadow-lg shadow-violet-600/25 flex items-center gap-2 cursor-pointer disabled:opacity-50"
                    >
                      <Save size={16} />
                      <span>{isSavingConfig ? "جاري الحفظ..." : "حفظ التغييرات المباشرة"}</span>
                    </button>
                  </div>
                </div>

                {/* Allowed Roles Visual Picker Panel */}
                <div className="lg:col-span-4 bg-slate-900/90 border border-slate-800 rounded-3xl p-6 space-y-4 flex flex-col justify-between shadow-xl shadow-black/30">
                  <div className="space-y-4">
                    <div className="pb-3 border-b border-slate-800 flex items-center justify-between">
                      <h3 className="text-sm font-bold text-white flex items-center gap-2">
                        <Layers size={16} className="text-purple-400" />
                        <span>إدارة الرتب المتاحة للأعضاء</span>
                      </h3>
                      {isLoadingRoles && <RefreshCw size={14} className="animate-spin text-slate-400" />}
                    </div>
                    
                    {/* Batch Arab Countries Roles Generator Card */}
                    <div className="p-3.5 bg-gradient-to-br from-emerald-950/70 via-slate-950/90 to-teal-950/70 border border-emerald-500/40 rounded-2xl space-y-2.5 shadow-lg shadow-emerald-950/40">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-300 flex items-center justify-center shrink-0">
                          <span className="text-base leading-none">🗺️</span>
                        </div>
                        <div>
                          <span className="text-xs font-bold text-emerald-300 block">رتب 22 دولة عربية</span>
                          <span className="text-[10px] text-slate-400 block">توليد كافة رتب الدول بأعلامها وتنسيق ألوانها دفعة واحدة</span>
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={isCreatingArabRoles}
                        onClick={handleCreateArabRoles}
                        className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md shadow-emerald-600/20 disabled:opacity-50"
                      >
                        {isCreatingArabRoles ? (
                          <>
                            <RefreshCw size={14} className="animate-spin" />
                            <span>جاري التوليد بالسيرفر...</span>
                          </>
                        ) : (
                          <>
                            <span>🇸🇦 🇪🇬 🇦🇪 توليد رتب الدول العربية الآن</span>
                          </>
                        )}
                      </button>

                      {arabRolesSuccessMsg && (
                        <div className="p-2 bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-[11px] font-medium rounded-xl text-center animate-pulse">
                          {arabRolesSuccessMsg}
                        </div>
                      )}
                    </div>

                    <p className="text-[11px] text-slate-400">
                      حدد الرتب التي يحق للأعضاء الحصول عليها مباشرة عند كتابة <code className="text-purple-300">إضافة رول</code> أو أمر <code className="text-emerald-300">/اختار-رتب</code>.
                    </p>

                    <div className="mt-2 space-y-2 max-h-60 overflow-y-auto pr-1">
                      {guildRoles.length > 0 ? (
                        guildRoles.map(role => {
                          const isSelected = configForm.allowedRoles.includes(role.id);
                          return (
                            <button
                              key={role.id}
                              type="button"
                              onClick={() => {
                                const newAllowed = isSelected
                                  ? configForm.allowedRoles.filter(id => id !== role.id)
                                  : [...configForm.allowedRoles, role.id];
                                setConfigForm({ ...configForm, allowedRoles: newAllowed });
                              }}
                              className={`w-full p-2.5 rounded-xl border flex items-center justify-between text-xs transition-all cursor-pointer ${
                                isSelected
                                  ? "bg-purple-950/50 border-purple-500/60 text-white"
                                  : "bg-slate-950/80 border-slate-800 text-slate-400 hover:border-slate-700"
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <span className="w-3 h-3 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: role.hexColor || "#99AAB5" }} />
                                <span className="font-medium">{role.name}</span>
                              </div>
                              {isSelected ? (
                                <CheckCircle2 size={16} className="text-purple-400" />
                              ) : (
                                <span className="text-[10px] text-slate-500 font-mono">{role.id}</span>
                              )}
                            </button>
                          );
                        })
                      ) : (
                        <div className="text-center py-6 text-slate-500 text-xs">
                          {isLoadingRoles ? "جاري تحميل رتب السيرفر..." : "لم يتم العثور على رتب أو البوت غير متصل."}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-800 text-[11px] text-slate-400">
                    عدد الرتب المحددة حالياً: <span className="font-bold text-purple-400">{configForm.allowedRoles.length}</span> رتبة
                  </div>
                </div>

              </form>
            ) : (
              <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-12 text-center text-slate-500 text-xs shadow-lg">
                يرجى اختيار سيرفر من القائمة أعلاه لبدء التعديل.
              </div>
            )}

          </motion.div>
        )}

        {/* TAB: MODERATION (قسم الإدارة) */}
        {activeTab === "mod" && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 md:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-lg">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-indigo-500/10 text-indigo-400 rounded-xl flex items-center justify-center">
                  <Shield size={20} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">إعدادات قسم الإدارة</h3>
                  <p className="text-[11px] text-slate-400">تخصيص رتب الإدارة المسموح لها باستخدام الأوامر، وتخصيص اختصارات الأوامر</p>
                </div>
              </div>

              <select
                value={selectedGuildId}
                onChange={(e) => setSelectedGuildId(e.target.value)}
                className="bg-slate-950 border border-slate-750 text-white rounded-xl px-4 py-2.5 text-xs focus:outline-none focus:border-indigo-500 cursor-pointer w-full sm:w-64 font-medium"
              >
                {guilds.map(g => (
                  <option key={g.id} value={g.id}>{g.name} ({g.id})</option>
                ))}
              </select>
            </div>

            {selectedGuildId ? (
              <form onSubmit={handleSaveConfig} className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 md:p-8 space-y-6 shadow-xl shadow-black/30">
                <div className="pb-4 border-b border-slate-800 flex items-center justify-between">
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Shield size={18} className="text-indigo-400" />
                    <span>صلاحيات واختصارات أوامر الإدارة</span>
                  </h3>
                  {configStatusMsg && (
                    <div className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                      configStatusMsg.type === "success" 
                        ? "bg-emerald-500/10 text-emerald-400"
                        : "bg-rose-500/10 text-rose-400"
                    }`}>
                      {configStatusMsg.text}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {/* Actions Grid */}
                  {[
                    { key: "ban", label: "حظر (Ban)", color: "rose" },
                    { key: "kick", label: "طرد (Kick)", color: "orange" },
                    { key: "timeout", label: "إسكات (Timeout)", color: "amber" },
                    { key: "warn", label: "تحذير (Warn)", color: "yellow" },
                    { key: "unban", label: "إزالة الحظر (Unban)", color: "emerald" },
                    { key: "untimeout", label: "إزالة الإسكات", color: "teal" },
                    { key: "unwarn", label: "إزالة التحذير", color: "green" },
                  ].map((action) => (
                    <div key={action.key} className="p-4 bg-slate-950/50 border border-slate-800/80 rounded-2xl space-y-4 relative overflow-hidden">
                      <div className={`absolute top-0 left-0 w-1 h-full bg-${action.color}-500/30`} />
                      <div>
                        <h4 className="text-sm font-bold text-white mb-1">{action.label}</h4>
                      </div>
                      
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">الاختصار النصي (الكلمة المفتاحية)</label>
                        <input
                          type="text"
                          value={configForm.moderationShortcuts[action.key] || ""}
                          onChange={(e) => {
                            setConfigForm({
                              ...configForm,
                              moderationShortcuts: { ...configForm.moderationShortcuts, [action.key]: e.target.value }
                            });
                          }}
                          placeholder="مثال: حظر، طرد"
                          className="w-full bg-slate-900 border border-slate-700 text-white text-xs rounded-xl px-3 py-2.5 focus:outline-none focus:border-indigo-500"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                          <span>الرتب المسموح لها</span>
                        </label>
                        <select
                          multiple
                          value={configForm.moderationRoles[action.key] || []}
                          onChange={(e) => {
                            const values = Array.from(e.target.selectedOptions, (option: HTMLOptionElement) => option.value);
                            setConfigForm({
                              ...configForm,
                              moderationRoles: { ...configForm.moderationRoles, [action.key]: values }
                            });
                          }}
                          className="w-full bg-slate-900 border border-slate-700 text-white text-xs rounded-xl px-3 py-2.5 focus:outline-none focus:border-indigo-500 h-24 scrollbar-thin scrollbar-thumb-slate-700"
                        >
                          {guildRoles.map(r => {
                            const isSelected = (configForm.moderationRoles[action.key] || []).includes(r.id);
                            return (
                              <option key={r.id} value={r.id} className="py-1">
                                {isSelected ? "✓ " : ""}{r.name}
                              </option>
                            );
                          })}
                        </select>
                        <p className="text-[9px] text-slate-500 mt-1">اضغط Ctrl لتحديد أكثر من رتبة.</p>
                      </div>
                    </div>
                  ))}
                </div>

                
                  <div className="bg-slate-950/80 border border-pink-500/30 rounded-2xl p-5 space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="flex items-center gap-2 text-white font-bold text-sm">
                        <span className="text-pink-400 text-lg">💌</span>
                        <span>نظام الاعترافات السرية</span>
                      </div>
                      <button
                        type="button"
                        onClick={async (e) => {
                          e.preventDefault();
                          setIsSendingConfession(true);
                          setConfessionStatusMsg(null);
                          try {
                            const res = await fetch("/api/guilds/" + selectedGuildId + "/send-confession-panel", { method: "POST" });
                            const data = await res.json();
                            setConfessionStatusMsg(data.message || (data.error ? "❌ خطأ: " + data.error : "تم الإرسال!"));
                          } catch (err) {
                            setConfessionStatusMsg("❌ حدث خطأ في الاتصال.");
                          } finally {
                            setIsSendingConfession(false);
                            setTimeout(() => setConfessionStatusMsg(null), 5000);
                          }
                        }}
                        disabled={isSendingConfession || !configForm.confessionPanelChannel}
                        className="px-4 py-2 bg-pink-600 hover:bg-pink-500 text-white font-bold text-[11px] rounded-xl transition-all flex items-center gap-2 cursor-pointer shadow-md shadow-pink-600/20 disabled:opacity-50"
                      >
                        {isSendingConfession ? <RefreshCw size={14} className="animate-spin" /> : <span>إرسال لوحة الاعترافات للسيرفر</span>}
                      </button>
                    </div>
                    {confessionStatusMsg && (
                      <div className="p-2 bg-pink-500/20 border border-pink-500/30 text-pink-300 text-[11px] font-medium rounded-xl text-center">
                        {confessionStatusMsg}
                      </div>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">روم لوحة الاعتراف (البانل)</label>
                        <select
                          value={configForm.confessionPanelChannel || ""}
                          onChange={(e) => setConfigForm({...configForm, confessionPanelChannel: e.target.value})}
                          className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl px-4 py-2 text-xs focus:outline-none focus:border-pink-500 cursor-pointer font-medium"
                        >
                          <option value="">-- اختر روم اللوحة --</option>
                          {channels.filter(c => c.guildId === selectedGuildId).map(c => (
                            <option key={c.id} value={c.id}># {c.name}</option>
                          ))}
                        </select>
                      </div>
                      
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">روم نشر الاعترافات (سري)</label>
                        <select
                          value={configForm.confessionChannel || ""}
                          onChange={(e) => setConfigForm({...configForm, confessionChannel: e.target.value})}
                          className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl px-4 py-2 text-xs focus:outline-none focus:border-pink-500 cursor-pointer font-medium"
                        >
                          <option value="">-- اختر روم نشر الاعترافات --</option>
                          {channels.filter(c => c.guildId === selectedGuildId).map(c => (
                            <option key={c.id} value={c.id}># {c.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>

                <div className="flex justify-end pt-4 border-t border-slate-800">
                  <button
                    type="submit"
                    disabled={isSavingConfig}
                    className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs rounded-xl transition-all flex items-center gap-2 cursor-pointer shadow-lg shadow-indigo-600/25 disabled:opacity-50"
                  >
                    <Save size={16} />
                    <span>{isSavingConfig ? "جاري الحفظ..." : "حفظ إعدادات قسم الإدارة"}</span>
                  </button>
                </div>
              </form>
            ) : (
              <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-12 text-center text-slate-500 text-xs shadow-lg">
                يرجى اختيار سيرفر من القائمة أعلاه لبدء التعديل.
              </div>
            )}
          </motion.div>
        )}

        {/* TAB: LOGS (سجلات الإدارة) */}
        {activeTab === "logs" && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 md:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-lg">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-teal-500/10 text-teal-400 rounded-xl flex items-center justify-center">
                  <Clock size={20} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">إعدادات سجلات الإدارة (Logs)</h3>
                  <p className="text-[11px] text-slate-400">تخصيص الرومات التي سيتم فيها تسجيل استخدام أوامر الإدارة</p>
                </div>
              </div>

              <select
                value={selectedGuildId}
                onChange={(e) => setSelectedGuildId(e.target.value)}
                className="bg-slate-950 border border-slate-750 text-white rounded-xl px-4 py-2.5 text-xs focus:outline-none focus:border-teal-500 cursor-pointer w-full sm:w-64 font-medium"
              >
                {guilds.map(g => (
                  <option key={g.id} value={g.id}>{g.name} ({g.id})</option>
                ))}
              </select>
            </div>

            {selectedGuildId ? (
              <form onSubmit={handleSaveConfig} className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 md:p-8 space-y-6 shadow-xl shadow-black/30">
                <div className="pb-4 border-b border-slate-800 flex items-center justify-between">
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Radio size={18} className="text-teal-400" />
                    <span>غرف تسجيل (Logs) أوامر الإدارة</span>
                  </h3>
                  {configStatusMsg && (
                    <div className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                      configStatusMsg.type === "success" 
                        ? "bg-emerald-500/10 text-emerald-400"
                        : "bg-rose-500/10 text-rose-400"
                    }`}>
                      {configStatusMsg.text}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="p-5 bg-slate-950/50 border border-slate-800/80 rounded-2xl space-y-4">
                    <h4 className="text-sm font-bold text-white mb-1 flex items-center gap-2">
                      <Shield size={16} className="text-teal-400" />
                      <span>روم سجلات الإدارة (Mod Logs)</span>
                    </h4>
                    <p className="text-[11px] text-slate-400">
                      الغرفة التي سيتم إرسال تقارير (الحظر، الطرد، الإسكات، التحذير وإزالتها) إليها.
                    </p>
                    
                    <select
                      value={configForm.logChannels?.modLogs || ""}
                      onChange={(e) => setConfigForm({
                        ...configForm,
                        logChannels: { ...configForm.logChannels, modLogs: e.target.value }
                      })}
                      className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl px-4 py-3 text-xs focus:outline-none focus:border-teal-500 cursor-pointer font-medium"
                    >
                      <option value="">-- إيقاف التسجيل (بدون روم) --</option>
                      {channels.filter(c => c.guildId === selectedGuildId).map(c => (
                        <option key={c.id} value={c.id}># {c.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex justify-end pt-4 border-t border-slate-800">
                  <button
                    type="submit"
                    disabled={isSavingConfig}
                    className="px-6 py-2.5 bg-teal-600 hover:bg-teal-500 text-white font-semibold text-xs rounded-xl transition-all flex items-center gap-2 cursor-pointer shadow-lg shadow-teal-600/25 disabled:opacity-50"
                  >
                    <Save size={16} />
                    <span>{isSavingConfig ? "جاري الحفظ..." : "حفظ إعدادات السجلات"}</span>
                  </button>
                </div>
              </form>
            ) : (
              <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-12 text-center text-slate-500 text-xs shadow-lg">
                يرجى اختيار سيرفر من القائمة أعلاه لبدء التعديل.
              </div>
            )}
          </motion.div>
        )}

        {/* TAB 3: MESSAGE BROADCAST CONSOLE */}
        {activeTab === "messages" && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
            
            <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 md:p-8 space-y-6 shadow-xl shadow-black/30">
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-4 border-b border-slate-800">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-violet-500/10 text-violet-400 rounded-xl flex items-center justify-center">
                    <MessageSquare size={22} />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white">إرسال إعلانات ورسائل باسم البوت</h3>
                    <p className="text-slate-400 text-xs mt-0.5">
                      نشر فوري للرسائل والإعلانات التفاعلية في أي قناة كتابية متاحة للبوت.
                    </p>
                  </div>
                </div>

                <button
                  onClick={fetchChannels}
                  disabled={isLoadingChannels}
                  type="button"
                  className="flex items-center gap-2 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-medium transition-all cursor-pointer border border-slate-700/60"
                >
                  <RefreshCw size={14} className={isLoadingChannels ? "animate-spin" : ""} />
                  <span>تحديث قائمة القنوات</span>
                </button>
              </div>

              <form onSubmit={handleSendMessage} className="grid grid-cols-1 md:grid-cols-12 gap-6">
                
                {/* Channel Selector Column */}
                <div className="md:col-span-4 space-y-3">
                  <label className="text-xs font-bold text-slate-300 block">اختر القناة المخصصة:</label>
                  
                  {isLoadingChannels ? (
                    <div className="w-full bg-slate-950/80 border border-slate-800 rounded-xl p-3 text-xs text-slate-400 animate-pulse">
                      جاري تحميل قنوات ديسكورد...
                    </div>
                  ) : channels.length > 0 ? (
                    <select
                      value={selectedChannelId}
                      onChange={(e) => setSelectedChannelId(e.target.value)}
                      className="w-full bg-slate-950/90 border border-slate-800 text-white rounded-xl px-4 py-3 text-xs focus:outline-none focus:border-violet-500 cursor-pointer transition-all"
                    >
                      {channels.map((chan) => (
                        <option key={chan.id} value={chan.id}>
                          #{chan.name} [{chan.guildName}]
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="w-full bg-slate-950/80 border border-slate-800 text-slate-500 rounded-xl p-3 text-xs">
                      لم يتم العثور على قنوات متاحة.
                    </div>
                  )}

                  <div className="bg-slate-950/80 p-3.5 rounded-2xl border border-slate-800 space-y-2 text-[11px] text-slate-400">
                    <span className="font-bold text-slate-200 block">💡 تلميحات للتنسيق:</span>
                    <ul className="space-y-1 list-disc list-inside text-slate-400">
                      <li>استخدم **نص عريض** للتأكيد.</li>
                      <li>استخدم @everyone أو @here للإشارة.</li>
                      <li>يمكنك إضافة الإيموجيات وتنسيق Markdown بسهولة.</li>
                    </ul>
                  </div>
                </div>

                {/* Message Text Area */}
                <div className="md:col-span-8 space-y-3">
                  <label className="text-xs font-bold text-slate-300 block">محتوى الرسالة المراد نشرها:</label>
                  
                  <textarea
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    placeholder="اكتب الإعلان أو الرسالة هنا... (مثال: أهلاً بكم جميعاً! تتوفر اليوم تجربة مجانية لإنشاء الرتب عبر أمر 'صنع رول' 🎉)"
                    rows={6}
                    className="w-full bg-slate-950/90 border border-slate-800 text-white placeholder-slate-600 rounded-2xl p-4 text-xs focus:outline-none focus:border-violet-500 transition-all resize-none"
                  />

                  {chatNotice && (
                    <div className={`p-3.5 rounded-xl text-xs font-semibold ${
                      chatNotice.type === "success"
                        ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                        : "bg-rose-500/10 text-rose-400 border border-rose-500/30"
                    }`}>
                      {chatNotice.text}
                    </div>
                  )}

                  <div className="flex items-center justify-end pt-2">
                    <button
                      type="submit"
                      disabled={isSendingMsg || !selectedChannelId || !messageText.trim()}
                      className="px-6 py-2.5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-semibold text-xs rounded-xl transition-all shadow-lg shadow-violet-600/25 flex items-center gap-2 cursor-pointer disabled:opacity-40"
                    >
                      <Send size={15} />
                      <span>{isSendingMsg ? "جاري الإرسال..." : "إرسال الرسالة بنجاح"}</span>
                    </button>
                  </div>
                </div>

              </form>
            </div>

          </motion.div>
        )}

        {/* TAB 4: GAMES LAUNCHPAD */}
        {activeTab === "games" && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
            
            <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 md:p-8 space-y-6 shadow-xl shadow-black/30">
              
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-4 border-b border-slate-800">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-emerald-500/10 text-emerald-400 rounded-xl flex items-center justify-center">
                    <Gamepad2 size={24} />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white">🎮 صالون الألعاب والتحكم المباشر</h3>
                    <p className="text-slate-400 text-xs mt-0.5">
                      إطلاق ألعاب التفاعل أو الكونسول التفاعلي بنقرة واحدة في القناة المحددة.
                    </p>
                  </div>
                </div>

                {/* Target Channel Selector for Games */}
                <div className="flex items-center gap-2 w-full md:w-auto">
                  <span className="text-xs text-slate-300 font-bold whitespace-nowrap">القناة المستهدفة:</span>
                  <select
                    value={selectedChannelId}
                    onChange={(e) => setSelectedChannelId(e.target.value)}
                    className="bg-slate-950/90 border border-slate-800 text-white rounded-xl px-3.5 py-2 text-xs focus:outline-none focus:border-violet-500 cursor-pointer w-full md:w-60"
                  >
                    {channels.map((chan) => (
                      <option key={chan.id} value={chan.id}>#{chan.name} [{chan.guildName}]</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Games System State & Direct Open/Close Toggle */}
              {(() => {
                const targetChannel = channels.find(c => c.id === selectedChannelId);
                const targetGuildId = targetChannel?.guildId || selectedGuildId;
                const targetGuild = guilds.find(g => g.id === targetGuildId);
                const isGamesActive = targetGuild ? targetGuild.gamesEnabled !== false : true;
                const isToggling = isTogglingFeature === `${targetGuildId}-games`;

                if (!targetGuildId) return null;

                return (
                  <div className={`p-4 rounded-2xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition-all ${
                    isGamesActive
                      ? "bg-purple-950/20 border-purple-500/30"
                      : "bg-rose-950/30 border-rose-500/40"
                  }`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                        isGamesActive ? "bg-purple-500/20 text-purple-400" : "bg-rose-500/20 text-rose-400"
                      }`}>
                        <Gamepad2 size={20} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-white">حالة قائمة ونشاط الألعاب للسيرفر:</span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            isGamesActive ? "bg-purple-500/20 text-purple-300 border border-purple-500/30" : "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                          }`}>
                            {isGamesActive ? "مفتوحة ونشطة 🟢" : "مغلقة ومعطلة 🔴"}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          {isGamesActive 
                            ? "جميع أوامر الألعاب (/games, xo, روليت, مافيا, كاذب) نشطة وتعمل بشكل طبيعي."
                            : "⚠️ قائمة الألعاب معطلة حالياً في هذا السيرفر - لن يستجيب البوت للأوامر حتى يتم فتحها."}
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={isToggling}
                      onClick={() => handleToggleFeature(targetGuildId, "games", !isGamesActive)}
                      className={`px-4 py-2 text-xs font-bold rounded-xl transition-all flex items-center gap-2 cursor-pointer shadow-md shrink-0 disabled:opacity-50 ${
                        isGamesActive
                          ? "bg-rose-600/90 hover:bg-rose-500 text-white shadow-rose-600/20"
                          : "bg-purple-600/90 hover:bg-purple-500 text-white shadow-purple-600/20"
                      }`}
                    >
                      <Power size={14} />
                      <span>{isToggling ? "جاري التحديث..." : isGamesActive ? "إغلاق قائمة الألعاب 🔒" : "فتح قائمة الألعاب 🎮"}</span>
                    </button>
                  </div>
                );
              })()}

              {gameNotice && (
                <div className={`p-3.5 rounded-xl text-xs font-semibold ${
                  gameNotice.type === "success"
                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                    : "bg-rose-500/10 text-rose-400 border border-rose-500/30"
                }`}>
                  {gameNotice.text}
                </div>
              )}

              {/* Game Cards Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                
                {/* Console */}
                <div className="bg-slate-950/80 border border-slate-800 hover:border-violet-500/50 rounded-2xl p-5 flex flex-col justify-between space-y-4 transition-all shadow-lg hover:shadow-violet-500/10">
                  <div className="flex items-center justify-between">
                    <div className="w-10 h-10 bg-violet-500/10 text-violet-400 rounded-xl flex items-center justify-center">
                      <Gamepad2 size={22} />
                    </div>
                    <span className="text-[10px] bg-violet-500/15 text-violet-300 px-2.5 py-0.5 rounded-full font-mono font-semibold">Console</span>
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">لوحة الألعاب الرسمية</h4>
                    <p className="text-[11px] text-slate-400 mt-1">إرسال كونسول الأزرار التفاعلي ليختار منه الأعضاء اللعبة المناسبة.</p>
                  </div>
                  <button
                    onClick={() => handleGameAction("send_console")}
                    disabled={isGameActionPending || !selectedChannelId}
                    className="w-full py-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-semibold text-xs rounded-xl transition-all cursor-pointer disabled:opacity-40 shadow-md shadow-violet-600/20"
                  >
                    إرسال لوحة التحكم
                  </button>
                </div>

                {/* XO */}
                <div className="bg-slate-950/80 border border-slate-800 hover:border-emerald-500/50 rounded-2xl p-5 flex flex-col justify-between space-y-4 transition-all shadow-lg hover:shadow-emerald-500/10">
                  <div className="flex items-center justify-between">
                    <div className="w-10 h-10 bg-emerald-500/10 text-emerald-400 rounded-xl flex items-center justify-center">
                      <Award size={22} />
                    </div>
                    <span className="text-[10px] bg-emerald-500/15 text-emerald-300 px-2.5 py-0.5 rounded-full font-mono font-semibold">XO Game</span>
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">لعبة XO الكلاسيكية</h4>
                    <p className="text-[11px] text-slate-400 mt-1">إحداث مواجهة إكس-أو مباشرة بين الأعضاء أو ضد البوت الذكي.</p>
                  </div>
                  <button
                    onClick={() => handleGameAction("launch_game", "xo")}
                    disabled={isGameActionPending || !selectedChannelId}
                    className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs rounded-xl transition-all cursor-pointer disabled:opacity-40 shadow-md shadow-emerald-600/20"
                  >
                    إطلاق لعبة XO
                  </button>
                </div>

                {/* Roulette */}
                <div className="bg-slate-950/80 border border-slate-800 hover:border-amber-500/50 rounded-2xl p-5 flex flex-col justify-between space-y-4 transition-all shadow-lg hover:shadow-amber-500/10">
                  <div className="flex items-center justify-between">
                    <div className="w-10 h-10 bg-amber-500/10 text-amber-400 rounded-xl flex items-center justify-center">
                      <Zap size={22} />
                    </div>
                    <span className="text-[10px] bg-amber-500/15 text-amber-300 px-2.5 py-0.5 rounded-full font-mono font-semibold">Roulette</span>
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">روليت التوكنات</h4>
                    <p className="text-[11px] text-slate-400 mt-1">رهان التوكنات وتجربة الحظ لربح رصيد إضافي.</p>
                  </div>
                  <button
                    onClick={() => handleGameAction("launch_game", "roulette")}
                    disabled={isGameActionPending || !selectedChannelId}
                    className="w-full py-2 bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs rounded-xl transition-all cursor-pointer disabled:opacity-40 shadow-md shadow-amber-600/20"
                  >
                    إطلاق الروليت
                  </button>
                </div>

                {/* Liar */}
                <div className="bg-slate-950/80 border border-slate-800 hover:border-rose-500/50 rounded-2xl p-5 flex flex-col justify-between space-y-4 transition-all shadow-lg hover:shadow-rose-500/10">
                  <div className="flex items-center justify-between">
                    <div className="w-10 h-10 bg-rose-500/10 text-rose-400 rounded-xl flex items-center justify-center">
                      <HelpCircle size={22} />
                    </div>
                    <span className="text-[10px] bg-rose-500/15 text-rose-300 px-2.5 py-0.5 rounded-full font-mono font-semibold">Who is Liar?</span>
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">سهرة من الكاذب؟</h4>
                    <p className="text-[11px] text-slate-400 mt-1">صالون التخمين والتحقيق (من 3 لـ 20 لاعب).</p>
                  </div>
                  <button
                    onClick={() => handleGameAction("launch_game", "liar")}
                    disabled={isGameActionPending || !selectedChannelId}
                    className="w-full py-2 bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs rounded-xl transition-all cursor-pointer disabled:opacity-40 shadow-md shadow-rose-600/20"
                  >
                    إطلاق سهرة من الكاذب
                  </button>
                </div>

                {/* Mafia */}
                <div className="bg-slate-950/80 border border-slate-800 hover:border-purple-500/50 rounded-2xl p-5 flex flex-col justify-between space-y-4 transition-all shadow-lg hover:shadow-purple-500/10">
                  <div className="flex items-center justify-between">
                    <div className="w-10 h-10 bg-purple-500/10 text-purple-400 rounded-xl flex items-center justify-center">
                      <Users size={22} />
                    </div>
                    <span className="text-[10px] bg-purple-500/15 text-purple-300 px-2.5 py-0.5 rounded-full font-mono font-semibold">Mafia Lobby</span>
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">سهرة المافيا التفاعلية</h4>
                    <p className="text-[11px] text-slate-400 mt-1">سهرة الغموض وكشف المفسدين بالليل (من 3 لـ 8 لاعبين).</p>
                  </div>
                  <button
                    onClick={() => handleGameAction("launch_game", "mafia")}
                    disabled={isGameActionPending || !selectedChannelId}
                    className="w-full py-2 bg-purple-600 hover:bg-purple-500 text-white font-semibold text-xs rounded-xl transition-all cursor-pointer disabled:opacity-40 shadow-md shadow-purple-600/20"
                  >
                    إطلاق سهرة المافيا
                  </button>
                </div>

                {/* Emergency Clear */}
                <div className="bg-slate-950/80 border border-rose-950 hover:border-rose-500/60 rounded-2xl p-5 flex flex-col justify-between space-y-4 transition-all shadow-lg">
                  <div className="flex items-center justify-between">
                    <div className="w-10 h-10 bg-rose-500/10 text-rose-400 rounded-xl flex items-center justify-center">
                      <Trash2 size={22} />
                    </div>
                    <span className="text-[10px] bg-rose-500/15 text-rose-300 px-2.5 py-0.5 rounded-full font-mono font-semibold">Reset</span>
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-rose-400">تصفير وإلغاء الألعاب العالقة</h4>
                    <p className="text-[11px] text-slate-400 mt-1">إنهاء وإلغاء أي جلسة لعب جارية في القناة المحددة فورا.</p>
                  </div>
                  <button
                    onClick={() => {
                      if (window.confirm("هل أنت متأكد من رغبتك في إلغاء كافة الألعاب العالقة في هذه القناة؟")) {
                        handleGameAction("clear_games");
                      }
                    }}
                    disabled={isGameActionPending || !selectedChannelId}
                    className="w-full py-2 bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 border border-rose-800/40 font-semibold text-xs rounded-xl transition-all cursor-pointer disabled:opacity-40"
                  >
                    تصفير القناة الآن
                  </button>
                </div>

              </div>
            </div>

          </motion.div>
        )}

        {/* TAB 5: COMMAND MANUAL & HELP */}
        {activeTab === "manual" && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* Member Commands */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 md:p-7 space-y-4 shadow-xl shadow-black/30">
                <div className="pb-3 border-b border-slate-800 flex items-center justify-between">
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Sparkles size={18} className="text-violet-400" />
                    <span>أوامر الأعضاء العاديين</span>
                  </h3>
                  <span className="text-xs text-slate-400">متاحة في أي قناة</span>
                </div>

                <div className="space-y-3">
                  {[
                    { cmd: "صنع رول", desc: "فتح غرفة خاصة لاختيار طريقة الدفع وإنشاء رتبة خاصة (مع الخيار المجاني 0)." },
                    { cmd: "إضافة رول", desc: "استعراض ورؤية قائمة الرتب المتاحة للمستخدم واختيار رتبة منها." },
                    { cmd: "نزع رول", desc: "إزالة أو نزع إحدى الرتب المكتسبة بسهولة مع فترة راحة 5 دقائق." },
                    { cmd: "رصيدي", desc: "عرض عدد توكنات التفاعل المحفوظة في حساب العضو." },
                    { cmd: "اوامر رول", desc: "عرض قائمة جميع الأوامر المتاحة للأعضاء داخل الديسكورد." }
                  ].map((item, idx) => (
                    <div key={idx} className="p-3.5 bg-slate-950/80 rounded-2xl border border-slate-800/90 space-y-1 hover:border-violet-500/30 transition-all">
                      <div className="flex items-center justify-between">
                        <code className="text-xs font-mono font-bold text-violet-300 bg-violet-500/10 px-2 py-0.5 rounded">{item.cmd}</code>
                        <button
                          onClick={() => copyToClipboard(item.cmd)}
                          className="text-slate-500 hover:text-white transition-colors cursor-pointer p-1"
                          title="نسخ الأمر"
                        >
                          {copiedCode === item.cmd ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                        </button>
                      </div>
                      <p className="text-[11px] text-slate-400">{item.desc}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Admin Commands & Instructions */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 md:p-7 space-y-4 shadow-xl shadow-black/30">
                <div className="pb-3 border-b border-slate-800 flex items-center justify-between">
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Shield size={18} className="text-cyan-400" />
                    <span>أوامر وتوجيهات الإدارة</span>
                  </h3>
                  <span className="text-xs text-slate-400">للمسؤولين فقط</span>
                </div>

                <div className="space-y-3">
                  {[
                    { cmd: "/دول-عربية", desc: "إنشاء وتجهيز رتب 22 دولة عربية بأعلامها وألوانها الرسمية وتفعيلها فورياً بالسيرفر." },
                    { cmd: "انشاء رتب الدول", desc: "أمر نصي مباشر للإدارة لتجهيز وتوليد رتب الدول العربية بدون سلاش." },
                    { cmd: "/admin-config", desc: "تحديد السيرفر وحساب استلام الكريدت وغرفة الدفع مباشرة من Discord." },
                    { cmd: "/setup [roles]", desc: "تحديد رتب السيرفر المسموح للمستخدمين بالحصول عليها." },
                    { cmd: "ترتيب الرتب", desc: "يجب أن تكون رتبة البوت أعلم وأعلى من الرتب التي يمنحها للأعضاء في Discord." },
                    { cmd: "تفعيل الـ Intents", desc: "تأكد من تفعيل Message Content & Guild Members في Discord Developer Portal." }
                  ].map((item, idx) => (
                    <div key={idx} className="p-3.5 bg-slate-950/80 rounded-2xl border border-slate-800/90 space-y-1 hover:border-cyan-500/30 transition-all">
                      <div className="flex items-center justify-between">
                        <code className="text-xs font-mono font-bold text-cyan-300 bg-cyan-500/10 px-2 py-0.5 rounded">{item.cmd}</code>
                        <button
                          onClick={() => copyToClipboard(item.cmd)}
                          className="text-slate-500 hover:text-white transition-colors cursor-pointer p-1"
                          title="نسخ الأمر"
                        >
                          {copiedCode === item.cmd ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                        </button>
                      </div>
                      <p className="text-[11px] text-slate-400">{item.desc}</p>
                    </div>
                  ))}
                </div>
              </div>

            </div>

          </motion.div>
        )}

      </main>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto px-4 md:px-8 border-t border-slate-800/80 py-8 flex flex-col md:flex-row items-center justify-between text-[11px] text-slate-500 gap-4">
        <div className="flex items-center gap-2">
          <Bot size={14} className="text-violet-400" />
          <span>RoleMaster Control Suite © 2026</span>
        </div>
        <div className="flex items-center gap-4">
          <span>نظام التشغيل: Cloud Native Run</span>
          <span className="text-violet-400">إصدار الألوان: Cyber Slate Violet</span>
        </div>
      </footer>
    </div>
  );
}
