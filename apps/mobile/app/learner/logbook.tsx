import { useMemo, useState } from "react";
import { SafeAreaView, ScrollView, StyleSheet, Text, View, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { ArrowLeft, Check, CheckCircle2, CircleDashed, ShieldCheck } from "lucide-react-native";

interface SkillItem {
  name: string;
  category: string;
  learnerSigned: boolean;
  instructorSigned: boolean;
}

const K53_CATEGORIES = [
  "All",
  "Vehicle Controls",
  "Basic Manoeuvres",
  "Road Procedures",
  "Parking",
  "Highway Driving",
  "Emergency Situations",
];

const INITIAL_SKILLS: SkillItem[] = [
  // Vehicle Controls
  { name: "Pre-drive exterior safety inspection", category: "Vehicle Controls", learnerSigned: true, instructorSigned: true },
  { name: "Seat, headrest & mirror adjustment", category: "Vehicle Controls", learnerSigned: true, instructorSigned: true },
  { name: "Starting the engine and dashboard checks", category: "Vehicle Controls", learnerSigned: true, instructorSigned: true },
  { name: "Smooth clutch control & finding biting point", category: "Vehicle Controls", learnerSigned: true, instructorSigned: false },
  { name: "Gear selection & progressive shifting", category: "Vehicle Controls", learnerSigned: true, instructorSigned: false },
  { name: "Smooth acceleration & throttle balance", category: "Vehicle Controls", learnerSigned: true, instructorSigned: false },
  { name: "Progressive & smooth braking technique", category: "Vehicle Controls", learnerSigned: true, instructorSigned: false },
  { name: "Handbrake control on gradients", category: "Vehicle Controls", learnerSigned: false, instructorSigned: false },

  // Basic Manoeuvres
  { name: "Incline / hill start without rollback", category: "Basic Manoeuvres", learnerSigned: true, instructorSigned: true },
  { name: "Reversing in a straight line (20m)", category: "Basic Manoeuvres", learnerSigned: true, instructorSigned: false },
  { name: "Reversing to the left around a 90° corner", category: "Basic Manoeuvres", learnerSigned: false, instructorSigned: false },
  { name: "Three-point turn in a narrow roadway", category: "Basic Manoeuvres", learnerSigned: false, instructorSigned: false },
  { name: "U-turn manoeuvre safely & legally", category: "Basic Manoeuvres", learnerSigned: false, instructorSigned: false },
  { name: "Moving off from the kerb with 5-point check", category: "Basic Manoeuvres", learnerSigned: true, instructorSigned: true },

  // Road Procedures
  { name: "K53 5-point observation routine", category: "Road Procedures", learnerSigned: true, instructorSigned: true },
  { name: "Lane positioning & lane discipline", category: "Road Procedures", learnerSigned: true, instructorSigned: false },
  { name: "Signalling in good time (3-5 seconds)", category: "Road Procedures", learnerSigned: true, instructorSigned: true },
  { name: "Negotiating standard intersections", category: "Road Procedures", learnerSigned: true, instructorSigned: false },
  { name: "4-way stop right-of-way execution", category: "Road Procedures", learnerSigned: true, instructorSigned: true },
  { name: "Traffic mini-circles and roundabouts", category: "Road Procedures", learnerSigned: false, instructorSigned: false },
  { name: "Safe following distance (2-second rule)", category: "Road Procedures", learnerSigned: true, instructorSigned: true },
  { name: "Pedestrian crossings & school zones", category: "Road Procedures", learnerSigned: true, instructorSigned: false },
  { name: "Safe overtaking and returning to lane", category: "Road Procedures", learnerSigned: false, instructorSigned: false },

  // Parking
  { name: "Parallel parking to the left (test bay)", category: "Parking", learnerSigned: false, instructorSigned: false },
  { name: "Parallel parking to the right (one-way)", category: "Parking", learnerSigned: false, instructorSigned: false },
  { name: "Alley docking / 90° bay parking (reverse)", category: "Parking", learnerSigned: false, instructorSigned: false },
  { name: "Incline parking with wheels turned to kerb", category: "Parking", learnerSigned: false, instructorSigned: false },
  { name: "Declining parking with wheels turned to kerb", category: "Parking", learnerSigned: false, instructorSigned: false },

  // Highway Driving
  { name: "Freeway acceleration lane merge", category: "Highway Driving", learnerSigned: false, instructorSigned: false },
  { name: "Freeway cruising & lane keeping (100-120 km/h)", category: "Highway Driving", learnerSigned: false, instructorSigned: false },
  { name: "Freeway deceleration lane exit", category: "Highway Driving", learnerSigned: false, instructorSigned: false },
  { name: "Toll plaza approach and stopping", category: "Highway Driving", learnerSigned: false, instructorSigned: false },

  // Emergency Situations
  { name: "Emergency stop on command without lockup", category: "Emergency Situations", learnerSigned: true, instructorSigned: false },
  { name: "Hazard perception & sudden obstacle reaction", category: "Emergency Situations", learnerSigned: false, instructorSigned: false },
  { name: "Wet-weather driving & aquaplaning awareness", category: "Emergency Situations", learnerSigned: false, instructorSigned: false },
  { name: "Tyre blowout & mechanical failure procedure", category: "Emergency Situations", learnerSigned: false, instructorSigned: false },
];

export default function DigitalLogbook() {
  const router = useRouter();
  const [activeCategory, setActiveCategory] = useState("All");
  const [skills, setSkills] = useState<SkillItem[]>(INITIAL_SKILLS);

  const toggleLearnerSign = (skillName: string) => {
    setSkills(prev =>
      prev.map(s => {
        if (s.name === skillName) {
          return { ...s, learnerSigned: !s.learnerSigned };
        }
        return s;
      })
    );
  };

  const filteredSkills = useMemo(() => {
    if (activeCategory === "All") return skills;
    return skills.filter(s => s.category === activeCategory);
  }, [skills, activeCategory]);

  const stats = useMemo(() => {
    const total = skills.length;
    const learnerDone = skills.filter(s => s.learnerSigned).length;
    const instructorDone = skills.filter(s => s.instructorSigned).length;
    const fullyMastered = skills.filter(s => s.learnerSigned && s.instructorSigned).length;
    const pct = Math.round((fullyMastered / total) * 100);

    return { total, learnerDone, instructorDone, fullyMastered, pct };
  }, [skills]);

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.backBtn}>
          <ArrowLeft size={18} color="#244b38" />
        </Pressable>
        <Text style={s.headerTitle}>K53 Digital Logbook</Text>
      </View>

      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={s.summaryCard}>
          <View style={s.summaryTop}>
            <View>
              <Text style={s.summaryEyebrow}>K53 DRIVING COMPETENCY</Text>
              <Text style={s.summaryTitle}>{stats.fullyMastered} of {stats.total} Mastered</Text>
            </View>
            <View style={s.progressBadge}>
              <Text style={s.progressBadgeText}>{stats.pct}%</Text>
            </View>
          </View>

          <View style={s.progressBarTrack}>
            <View style={[s.progressBarFill, { width: `${stats.pct}%` }]} />
          </View>

          <View style={s.summaryDetails}>
            <Text style={s.summaryDetailText}>
              ✓ {stats.learnerDone} skills self-logged by you
            </Text>
            <Text style={s.summaryDetailText}>
              ★ {stats.instructorDone} verified by certified instructor
            </Text>
          </View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filterScroll}>
          {K53_CATEGORIES.map(cat => (
            <Pressable
              key={cat}
              style={[s.filterChip, activeCategory === cat && s.filterChipActive]}
              onPress={() => setActiveCategory(cat)}
            >
              <Text style={[s.filterText, activeCategory === cat && s.filterTextActive]}>
                {cat}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        <View style={s.skillsList}>
          {filteredSkills.map(skill => {
            const isMastered = skill.learnerSigned && skill.instructorSigned;

            return (
              <View key={skill.name} style={[s.skillCard, isMastered && s.skillCardMastered]}>
                <View style={s.skillInfo}>
                  <Text style={s.skillName}>{skill.name}</Text>
                  <Text style={s.skillCat}>{skill.category}</Text>

                  <View style={s.signStatusRow}>
                    <View style={s.statusBadge}>
                      {skill.learnerSigned ? (
                        <CheckCircle2 size={13} color="#15803d" />
                      ) : (
                        <CircleDashed size={13} color="#8a9488" />
                      )}
                      <Text style={[s.statusText, skill.learnerSigned && s.statusTextActive]}>
                        Learner Signed
                      </Text>
                    </View>

                    <View style={s.statusBadge}>
                      {skill.instructorSigned ? (
                        <CheckCircle2 size={13} color="#2563eb" />
                      ) : (
                        <CircleDashed size={13} color="#8a9488" />
                      )}
                      <Text style={[s.statusText, skill.instructorSigned && s.statusTextInstructor]}>
                        Instructor Verified
                      </Text>
                    </View>
                  </View>
                </View>

                <Pressable
                  style={[s.signButton, skill.learnerSigned && s.signButtonActive]}
                  onPress={() => toggleLearnerSign(skill.name)}
                >
                  <Text style={[s.signButtonText, skill.learnerSigned && s.signButtonTextActive]}>
                    {skill.learnerSigned ? "Signed ✓" : "Sign Off"}
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </View>
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
  headerTitle: { fontSize: 16, fontWeight: "700", color: "#202c25" },
  content: { padding: 18, paddingBottom: 48 },
  summaryCard: {
    backgroundColor: "white",
    padding: 18,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e4e8e0",
    marginBottom: 16,
  },
  summaryTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  summaryEyebrow: { fontSize: 9, fontWeight: "700", letterSpacing: 1.2, color: "#63806a" },
  summaryTitle: { fontSize: 18, fontWeight: "800", color: "#1e2920", marginTop: 4 },
  progressBadge: {
    backgroundColor: "#e8f2e6",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  progressBadgeText: { fontSize: 14, fontWeight: "800", color: "#244b38" },
  progressBarTrack: {
    height: 8,
    backgroundColor: "#edf0eb",
    borderRadius: 4,
    overflow: "hidden",
    marginVertical: 10,
  },
  progressBarFill: {
    height: "100%",
    backgroundColor: "#244b38",
    borderRadius: 4,
  },
  summaryDetails: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  summaryDetailText: { fontSize: 11, color: "#546053", fontWeight: "500" },
  filterScroll: { maxHeight: 42, marginBottom: 16 },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: "white",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#e4e8e0",
    marginRight: 8,
  },
  filterChipActive: { backgroundColor: "#244b38", borderColor: "#244b38" },
  filterText: { fontSize: 11, color: "#4d5b4e", fontWeight: "600" },
  filterTextActive: { color: "white" },
  skillsList: { gap: 10 },
  skillCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "white",
    padding: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e6e8e2",
  },
  skillCardMastered: {
    borderColor: "#bbf7d0",
    backgroundColor: "#fafdf9",
  },
  skillInfo: { flex: 1, marginRight: 10 },
  skillName: { fontSize: 13, fontWeight: "700", color: "#222f24", lineHeight: 18 },
  skillCat: { fontSize: 10, color: "#748072", marginTop: 2, marginBottom: 6 },
  signStatusRow: { flexDirection: "row", gap: 12 },
  statusBadge: { flexDirection: "row", alignItems: "center", gap: 4 },
  statusText: { fontSize: 10, color: "#7e887d" },
  statusTextActive: { color: "#15803d", fontWeight: "600" },
  statusTextInstructor: { color: "#2563eb", fontWeight: "600" },
  signButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#f2f5f0",
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#d8ded4",
  },
  signButtonActive: {
    backgroundColor: "#e8f3e5",
    borderColor: "#244b38",
  },
  signButtonText: { fontSize: 11, fontWeight: "700", color: "#364a38" },
  signButtonTextActive: { color: "#244b38" },
});
