import { useEffect, useRef, useState } from "react";
import { SafeAreaView, ScrollView, StyleSheet, Text, View, Pressable, Alert } from "react-native";
import { useRouter } from "expo-router";
import { AlertTriangle, ArrowLeft, Check, CheckCircle2, Clock, Compass, Gauge, Shield, ShieldAlert } from "lucide-react-native";

export default function MobileActiveSession() {
  const router = useRouter();
  const [seconds, setSeconds] = useState(0);
  const [speed, setSpeed] = useState(0);
  const [sosCountdown, setSosCountdown] = useState<number | null>(null);
  const [sosSent, setSosSent] = useState(false);

  // Safety checks
  const [checks, setChecks] = useState<Record<string, boolean>>({
    seatbelt: true,
    mirrors: true,
    vehicle: true,
    route: false,
  });

  // Simulated GPS coordinates (e.g. Sandton / Johannesburg)
  const coords = { lat: -26.1076, lng: 28.0567 };

  // Timer
  useEffect(() => {
    const timer = setInterval(() => {
      setSeconds(s => s + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Speed simulation (subtle variance between 20-55 km/h for driving lesson)
  useEffect(() => {
    const speedTimer = setInterval(() => {
      const targetSpeed = Math.floor(Math.random() * 35) + 20; // 20 - 55 km/h
      setSpeed(targetSpeed);
    }, 3500);
    return () => clearInterval(speedTimer);
  }, []);

  // SOS Countdown handler
  useEffect(() => {
    if (sosCountdown === null) return;
    if (sosCountdown <= 0) {
      setSosCountdown(null);
      setSosSent(true);
      Alert.alert(
        "SOS Dispatched",
        `Emergency distress alert sent with live GPS coordinates (${coords.lat}, ${coords.lng}) to local dispatch and your emergency contact.`,
        [{ text: "OK" }]
      );
      return;
    }

    const timer = setTimeout(() => {
      setSosCountdown(c => (c !== null ? c - 1 : null));
    }, 1000);

    return () => clearTimeout(timer);
  }, [sosCountdown]);

  const triggerSos = () => {
    setSosCountdown(3);
  };

  const cancelSos = () => {
    setSosCountdown(null);
  };

  const toggleCheck = (key: string) => {
    setChecks(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const formatTime = (totalSec: number) => {
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    return `${hrs > 0 ? hrs + ":" : ""}${mins < 10 ? "0" : ""}${mins}:${secs < 10 ? "0" : ""}${secs}`;
  };

  const allChecksDone = Object.values(checks).every(Boolean);

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.backBtn}>
          <ArrowLeft size={18} color="#244b38" />
        </Pressable>
        <Text style={s.headerTitle}>Live Driving Session</Text>
        <View style={s.liveBadge}>
          <View style={s.liveDot} />
          <Text style={s.liveText}>ON ROAD</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        {/* Telemetry HUD */}
        <View style={s.hudCard}>
          <View style={s.hudRow}>
            <View style={s.speedBlock}>
              <View style={s.speedCircle}>
                <Text style={s.speedNumber}>{speed}</Text>
                <Text style={s.speedUnit}>KM/H</Text>
              </View>
              <Text style={s.hudSub}>Current Speed</Text>
            </View>

            <View style={s.statBlock}>
              <View style={s.metricItem}>
                <Clock size={15} color="#546053" />
                <View>
                  <Text style={s.metricLabel}>ELAPSED</Text>
                  <Text style={s.metricVal}>{formatTime(seconds)}</Text>
                </View>
              </View>

              <View style={s.metricItem}>
                <Compass size={15} color="#546053" />
                <View>
                  <Text style={s.metricLabel}>GPS COORDS</Text>
                  <Text style={s.metricVal}>{coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}</Text>
                </View>
              </View>

              <View style={s.metricItem}>
                <Shield size={15} color="#546053" />
                <View>
                  <Text style={s.metricLabel}>ACCURACY</Text>
                  <Text style={s.metricVal}>High (±3m)</Text>
                </View>
              </View>
            </View>
          </View>
        </View>

        {/* SOS Emergency Section */}
        <View style={s.sosCard}>
          <View style={s.sosInfo}>
            <Text style={s.sosTitle}>Emergency Response Radar</Text>
            <Text style={s.sosDesc}>
              Tap the SOS button to instantly alert local armed response, emergency services, and your designated emergency contact with GPS coordinates.
            </Text>
          </View>

          {sosCountdown !== null ? (
            <View style={s.sosCountdownBox}>
              <Text style={s.sosCountdownText}>Dispatching SOS in {sosCountdown}s</Text>
              <Pressable style={s.cancelSosBtn} onPress={cancelSos}>
                <Text style={s.cancelSosText}>Tap to Cancel</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              style={[s.sosButton, sosSent && s.sosButtonSent]}
              onPress={triggerSos}
            >
              <ShieldAlert size={28} color="white" />
              <Text style={s.sosButtonText}>
                {sosSent ? "SOS DISPATCHED" : "HOLD FOR SOS"}
              </Text>
            </Pressable>
          )}
        </View>

        {/* Pre-Trip Safety Compliance */}
        <View style={s.safetyCard}>
          <View style={s.safetyHeader}>
            <Text style={s.safetyEyebrow}>K53 REGULATION CHECKS</Text>
            <Text style={s.safetyTitle}>Safety & Pre-Drive Compliance</Text>
          </View>

          <View style={s.checkList}>
            {[
              ["seatbelt", "Seatbelts securely fastened (both parties)"],
              ["mirrors", "Interior & exterior mirrors adjusted correctly"],
              ["vehicle", "Pre-trip vehicle check & dual controls verified"],
              ["route", "Lesson objectives & practice route confirmed"],
            ].map(([key, label]) => {
              const checked = checks[key];
              return (
                <Pressable
                  key={key}
                  style={[s.checkRow, checked && s.checkRowActive]}
                  onPress={() => toggleCheck(key)}
                >
                  <View style={[s.checkbox, checked && s.checkboxActive]}>
                    {checked && <Check size={14} color="white" />}
                  </View>
                  <Text style={[s.checkLabel, checked && s.checkLabelActive]}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {allChecksDone && (
            <View style={s.readyPill}>
              <CheckCircle2 size={15} color="#15803d" />
              <Text style={s.readyPillText}>Ready for road instruction</Text>
            </View>
          )}
        </View>

        {/* Finish Session */}
        <Pressable
          style={s.endSessionBtn}
          onPress={() => {
            Alert.alert(
              "Finish Driving Lesson",
              `Lesson duration: ${formatTime(seconds)}. Would you like to record this session in your Digital Logbook?`,
              [
                { text: "Continue Driving", style: "cancel" },
                {
                  text: "Save & Open Logbook",
                  onPress: () => router.replace("/learner/logbook"),
                },
              ]
            );
          }}
        >
          <Text style={s.endSessionText}>Finish & Save to Logbook →</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f8f7f2" },
  header: {
    height: 54,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "white",
    borderBottomWidth: 1,
    borderBottomColor: "#ecece7",
  },
  backBtn: { padding: 8, marginRight: 8 },
  headerTitle: { fontSize: 16, fontWeight: "700", color: "#202c25", flex: 1 },
  liveBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#ecfdf5",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#a7f3d0",
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#10b981" },
  liveText: { fontSize: 9, fontWeight: "800", color: "#065f46", letterSpacing: 0.5 },
  content: { padding: 18, paddingBottom: 48 },
  hudCard: {
    backgroundColor: "white",
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: "#e4e8e0",
    marginBottom: 16,
  },
  hudRow: { flexDirection: "row", alignItems: "center", gap: 20 },
  speedBlock: { alignItems: "center" },
  speedCircle: {
    width: 104,
    height: 104,
    borderRadius: 52,
    borderWidth: 4,
    borderColor: "#244b38",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f4f8f4",
  },
  speedNumber: { fontSize: 36, fontWeight: "900", color: "#1e2920" },
  speedUnit: { fontSize: 10, fontWeight: "700", color: "#617260", marginTop: -2 },
  hudSub: { fontSize: 11, fontWeight: "600", color: "#687569", marginTop: 8 },
  statBlock: { flex: 1, gap: 12 },
  metricItem: { flexDirection: "row", alignItems: "center", gap: 10 },
  metricLabel: { fontSize: 9, fontWeight: "700", color: "#748073", letterSpacing: 0.6 },
  metricVal: { fontSize: 13, fontWeight: "700", color: "#243226" },
  sosCard: {
    backgroundColor: "#fef2f2",
    borderRadius: 12,
    padding: 18,
    borderWidth: 1.5,
    borderColor: "#fecaca",
    marginBottom: 16,
    alignItems: "center",
  },
  sosInfo: { alignItems: "center", marginBottom: 14 },
  sosTitle: { fontSize: 15, fontWeight: "700", color: "#991b1b", marginBottom: 4 },
  sosDesc: { fontSize: 11, color: "#7f1d1d", textAlign: "center", lineHeight: 16 },
  sosButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#dc2626",
    width: "100%",
    paddingVertical: 14,
    borderRadius: 8,
    elevation: 3,
  },
  sosButtonSent: { backgroundColor: "#15803d" },
  sosButtonText: { fontSize: 13, fontWeight: "800", color: "white", letterSpacing: 0.5 },
  sosCountdownBox: { alignItems: "center", gap: 8, width: "100%" },
  sosCountdownText: { fontSize: 15, fontWeight: "800", color: "#b91c1c" },
  cancelSosBtn: {
    backgroundColor: "white",
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#ef4444",
  },
  cancelSosText: { fontSize: 12, fontWeight: "700", color: "#b91c1c" },
  safetyCard: {
    backgroundColor: "white",
    borderRadius: 12,
    padding: 18,
    borderWidth: 1,
    borderColor: "#e4e8e0",
    marginBottom: 18,
  },
  safetyHeader: { marginBottom: 14 },
  safetyEyebrow: { fontSize: 9, fontWeight: "700", letterSpacing: 1.2, color: "#63806a" },
  safetyTitle: { fontSize: 15, fontWeight: "700", color: "#1e2920", marginTop: 4 },
  checkList: { gap: 10 },
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e5e8e2",
    backgroundColor: "#fafbf9",
    gap: 12,
  },
  checkRowActive: { backgroundColor: "#f0fdf4", borderColor: "#86efac" },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: "#a3ae9f",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "white",
  },
  checkboxActive: { backgroundColor: "#15803d", borderColor: "#15803d" },
  checkLabel: { fontSize: 12, color: "#445043", flex: 1 },
  checkLabelActive: { color: "#14532d", fontWeight: "600" },
  readyPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#f0fdf4",
    padding: 10,
    borderRadius: 6,
    marginTop: 12,
  },
  readyPillText: { fontSize: 12, color: "#15803d", fontWeight: "600" },
  endSessionBtn: {
    backgroundColor: "#244b38",
    paddingVertical: 15,
    borderRadius: 8,
    alignItems: "center",
  },
  endSessionText: { fontSize: 13, fontWeight: "700", color: "white" },
});
