import { Link } from "expo-router";
import { SafeAreaView, ScrollView, StyleSheet, Text, View, Pressable } from "react-native";
import { BookOpen, CalendarDays, CarFront, CheckCircle2, Gauge, GraduationCap, MessageCircle, ShieldAlert, Sparkles } from "lucide-react-native";

const quickTools = [
  { label: "K53 Test Simulator", href: "/learner/k53" as const, desc: "Rules, road signs & controls quiz", icon: BookOpen, badge: "Practice" },
  { label: "Digital Logbook", href: "/learner/logbook" as const, desc: "48 competencies & sign-offs", icon: GraduationCap, badge: "Track" },
  { label: "Live Driving Session", href: "/active-session" as const, desc: "HUD, telemetry & emergency SOS", icon: Gauge, badge: "Active" },
] as const;

const nav = [
  { label: "Book a new lesson", href: "/learner/book" as const, icon: CarFront },
  { label: "My lessons & receipts", href: "/learner/lessons" as const, icon: CalendarDays },
  { label: "Messages & chat", href: "/learner/messages" as const, icon: MessageCircle },
  { label: "Explore all instructors", href: "/" as const, icon: CarFront },
] as const;

export default function LearnerHome() {
  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
        <Text style={s.eyebrow}>YOUR LEARNER SPACE</Text>
        <Text style={s.title}>Ready to get moving?</Text>
        <Text style={s.copy}>
          Master your K53, track your lesson hours, and book verified instructors across Mzansi.
        </Text>

        {/* High-priority Action Cards */}
        <View style={s.featureGrid}>
          {quickTools.map(tool => {
            const Icon = tool.icon;
            return (
              <Link key={tool.href} href={tool.href} asChild>
                <Pressable style={s.featureCard}>
                  <View style={s.featureCardTop}>
                    <View style={s.featureIconWrap}>
                      <Icon size={20} color="#244b38" />
                    </View>
                    <Text style={s.featureBadge}>{tool.badge}</Text>
                  </View>
                  <Text style={s.featureTitle}>{tool.label}</Text>
                  <Text style={s.featureDesc}>{tool.desc}</Text>
                </Pressable>
              </Link>
            );
          })}
        </View>

        {/* Onboarding Callout */}
        <View style={s.panel}>
          <View style={s.panelTop}>
            <Sparkles size={16} color="#244b38" />
            <Text style={s.panelEyebrow}>K53 ROAD-READY PATH</Text>
          </View>
          <Text style={s.panelTitle}>Book your next driving lesson</Text>
          <Text style={s.copy}>
            Compare top-rated instructors near you with manual or automatic dual-control vehicles.
          </Text>
          <Link href="/learner/book" asChild>
            <Pressable style={s.primaryButton}>
              <Text style={s.primaryButtonText}>Find Lesson Times →</Text>
            </Pressable>
          </Link>
        </View>

        {/* Navigation Rows */}
        <Text style={s.section}>Manage your journey</Text>
        <View style={s.navGroup}>
          {nav.map(item => {
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} asChild>
                <Pressable style={s.row}>
                  <View style={s.rowIconBox}>
                    <Icon size={18} color="#244b38" />
                  </View>
                  <Text style={s.rowText}>{item.label}</Text>
                  <Text style={s.arrow}>→</Text>
                </Pressable>
              </Link>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f8f7f2" },
  body: { padding: 18, paddingBottom: 48 },
  eyebrow: { fontSize: 10, fontWeight: "700", letterSpacing: 1.2, color: "#63806a" },
  title: { fontSize: 28, fontWeight: "700", color: "#202c25", marginTop: 6 },
  copy: { fontSize: 12, color: "#6b7568", lineHeight: 18, marginTop: 6, marginBottom: 16 },
  featureGrid: { gap: 10, marginBottom: 16 },
  featureCard: {
    backgroundColor: "white",
    borderRadius: 10,
    padding: 16,
    borderWidth: 1,
    borderColor: "#e4e8e0",
  },
  featureCardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  featureIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#e8f2e6",
    alignItems: "center",
    justifyContent: "center",
  },
  featureBadge: {
    fontSize: 9,
    fontWeight: "700",
    color: "#244b38",
    backgroundColor: "#e8f2e6",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  featureTitle: { fontSize: 15, fontWeight: "700", color: "#1f2d21" },
  featureDesc: { fontSize: 11, color: "#6e776b", marginTop: 2 },
  panel: {
    padding: 18,
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#e4e8e0",
    borderRadius: 10,
    marginBottom: 20,
  },
  panelTop: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  panelEyebrow: { fontSize: 9, fontWeight: "800", color: "#244b38", letterSpacing: 0.8 },
  panelTitle: { fontSize: 16, fontWeight: "700", color: "#222f23", marginTop: 4 },
  primaryButton: {
    alignSelf: "flex-start",
    marginTop: 14,
    backgroundColor: "#244b38",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 6,
  },
  primaryButtonText: { color: "white", fontSize: 12, fontWeight: "700" },
  section: { fontSize: 13, fontWeight: "700", color: "#253427", marginBottom: 10 },
  navGroup: {
    backgroundColor: "white",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e5e8e2",
    overflow: "hidden",
  },
  row: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#edf0ea",
  },
  rowIconBox: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#f4f7f2",
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: { fontSize: 13, color: "#323f33", flex: 1, fontWeight: "600" },
  arrow: { fontSize: 16, color: "#8b9688", fontWeight: "600" },
});
