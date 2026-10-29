import { useMemo, useState } from "react";
import { SafeAreaView, ScrollView, StyleSheet, Text, View, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { ArrowLeft, Award, CheckCircle2, RotateCcw, ShieldCheck, XCircle } from "lucide-react-native";

interface Question {
  id: number;
  category: "Rules of the Road" | "Road Signs" | "Vehicle Controls";
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

const K53_QUESTIONS: Question[] = [
  {
    id: 1,
    category: "Rules of the Road",
    question: "When are you allowed to overtake another vehicle on its left-hand side?",
    options: [
      "Never under any circumstances on South African roads",
      "When the vehicle ahead is turning right and you have indicated clearly",
      "Whenever you are driving on a dual carriageway or freeway",
      "Only between sunrise and sunset",
    ],
    correctIndex: 1,
    explanation: "Under K53 rules, overtaking on the left is permitted when the vehicle ahead is turning right, on one-way streets with 2+ lanes, or when directed by a traffic officer.",
  },
  {
    id: 2,
    category: "Rules of the Road",
    question: "What is the general maximum speed limit on a South African freeway unless indicated otherwise?",
    options: [
      "100 km/h",
      "110 km/h",
      "120 km/h",
      "130 km/h",
    ],
    correctIndex: 2,
    explanation: "The default national speed limit on freeways in South Africa is 120 km/h.",
  },
  {
    id: 3,
    category: "Road Signs",
    question: "What does an inverted red and white triangular road sign mean?",
    options: [
      "Stop completely before the white line",
      "Yield / Give way to oncoming or crossing traffic",
      "No entry for all motor vehicles",
      "Sharp curve to the left ahead",
    ],
    correctIndex: 1,
    explanation: "An inverted triangle is the universal Yield sign, requiring drivers to yield right-of-way to other vehicles and pedestrians.",
  },
  {
    id: 4,
    category: "Road Signs",
    question: "What does a circular road sign with a red border and white background indicate?",
    options: [
      "A guidance / tourism sign",
      "A prohibitory / regulatory command sign (do not do this)",
      "A temporary roadwork warning",
      "A recommended advisory speed",
    ],
    correctIndex: 1,
    explanation: "Circular signs with red borders indicate prohibitions (e.g. no U-turn, speed limits, no overtaking).",
  },
  {
    id: 5,
    category: "Vehicle Controls",
    question: "Which foot controls the accelerator (gas) and footbrake in a manual vehicle?",
    options: [
      "Left foot for brake, right foot for accelerator",
      "Right foot controls both the accelerator and the footbrake",
      "Left foot controls both the clutch and footbrake",
      "Either foot depending on driver comfort",
    ],
    correctIndex: 1,
    explanation: "Under K53, the right foot operates both the footbrake and accelerator. The left foot is exclusively reserved for the clutch.",
  },
  {
    id: 6,
    category: "Vehicle Controls",
    question: "What is the correct 5-point observation routine before moving off from a standstill?",
    options: [
      "Rearview mirror only, then accelerate",
      "Blind spot left, left mirror, rear mirror, right mirror, blind spot right",
      "Look straight ahead and check the hazard lights",
      "Honk horn, engage 2nd gear, and release handbrake",
    ],
    correctIndex: 1,
    explanation: "K53 requires a complete 5-point check: blind spot left -> left mirror -> rearview mirror -> right mirror -> blind spot right.",
  },
  {
    id: 7,
    category: "Rules of the Road",
    question: "What is the minimum safe following distance behind a vehicle ahead under ideal dry conditions?",
    options: [
      "1 second",
      "2 seconds",
      "4 seconds",
      "10 metres",
    ],
    correctIndex: 1,
    explanation: "The standard following distance is the 2-second rule. Under wet weather or night driving, it doubles to 4 seconds.",
  },
  {
    id: 8,
    category: "Road Signs",
    question: "A solid single white line in the middle of a two-way road means:",
    options: [
      "You may overtake if there are no police cars in sight",
      "You may never cross or straddle the line to overtake",
      "Parking is allowed on both sides of the roadway",
      "Traffic moves in the same direction on both sides",
    ],
    correctIndex: 1,
    explanation: "A solid barrier line prohibits drivers from crossing or straddling it to overtake other vehicles.",
  },
  {
    id: 9,
    category: "Vehicle Controls",
    question: "When should the parking handbrake be released when executing a hill start?",
    options: [
      "Before starting the engine",
      "As soon as the clutch reaches the biting point and engine tone changes",
      "Only after the vehicle starts rolling backwards",
      "While keeping the clutch pressed completely to the floor",
    ],
    correctIndex: 1,
    explanation: "On an incline, find the clutch friction/biting point, apply slight accelerator throttle, then smoothly release the handbrake to prevent rollback.",
  },
  {
    id: 10,
    category: "Rules of the Road",
    question: "At a 4-way stop intersection in South Africa, who has the right-of-way?",
    options: [
      "The vehicle travelling fastest",
      "The vehicle approaching from the right",
      "The vehicle that came to a complete stop first",
      "Public transport and minibus taxis always take priority",
    ],
    correctIndex: 2,
    explanation: "At a 4-way stop, right-of-way is strictly determined by arrival: the first vehicle that stops completely is the first to proceed.",
  },
];

export default function K53Simulator() {
  const router = useRouter();
  const [category, setCategory] = useState<string>("All");
  const [currentIdx, setCurrentIdx] = useState<number>(0);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, number>>({});
  const [isFinished, setIsFinished] = useState<boolean>(false);

  const filteredQuestions = useMemo(() => {
    if (category === "All") return K53_QUESTIONS;
    return K53_QUESTIONS.filter(q => q.category === category);
  }, [category]);

  const activeQuestion = filteredQuestions[currentIdx] ?? filteredQuestions[0];
  const userPick = selectedAnswers[activeQuestion.id];

  const handleSelectOption = (index: number) => {
    if (userPick !== undefined) return; // Already picked for this question
    setSelectedAnswers(prev => ({ ...prev, [activeQuestion.id]: index }));
  };

  const score = useMemo(() => {
    let correct = 0;
    filteredQuestions.forEach(q => {
      if (selectedAnswers[q.id] === q.correctIndex) {
        correct++;
      }
    });
    return correct;
  }, [selectedAnswers, filteredQuestions]);

  const percentage = Math.round((score / filteredQuestions.length) * 100);
  const passed = percentage >= 80;

  const restartQuiz = () => {
    setSelectedAnswers({});
    setCurrentIdx(0);
    setIsFinished(false);
  };

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.backBtn}>
          <ArrowLeft size={18} color="#244b38" />
        </Pressable>
        <Text style={s.headerTitle}>K53 Test Simulator</Text>
      </View>

      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        {!isFinished ? (
          <>
            <View style={s.categoryBar}>
              {["All", "Rules of the Road", "Road Signs", "Vehicle Controls"].map(cat => (
                <Pressable
                  key={cat}
                  style={[s.catChip, category === cat && s.catChipActive]}
                  onPress={() => {
                    setCategory(cat);
                    setCurrentIdx(0);
                    setSelectedAnswers({});
                  }}
                >
                  <Text style={[s.catChipText, category === cat && s.catChipTextActive]}>
                    {cat}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View style={s.progressRow}>
              <Text style={s.progressText}>
                Question {currentIdx + 1} of {filteredQuestions.length}
              </Text>
              <Text style={s.categoryBadge}>{activeQuestion.category}</Text>
            </View>

            <View style={s.questionCard}>
              <Text style={s.questionText}>{activeQuestion.question}</Text>
            </View>

            <View style={s.optionsContainer}>
              {activeQuestion.options.map((option, idx) => {
                const isSelected = userPick === idx;
                const isCorrect = idx === activeQuestion.correctIndex;
                const hasAnswered = userPick !== undefined;

                return (
                  <Pressable
                    key={idx}
                    style={[
                      s.optionCard,
                      hasAnswered && isCorrect && s.optionCorrect,
                      hasAnswered && isSelected && !isCorrect && s.optionIncorrect,
                    ]}
                    onPress={() => handleSelectOption(idx)}
                  >
                    <View style={s.optionBullet}>
                      <Text style={s.optionBulletText}>{String.fromCharCode(65 + idx)}</Text>
                    </View>
                    <Text style={s.optionText}>{option}</Text>
                  </Pressable>
                );
              })}
            </View>

            {userPick !== undefined && (
              <View style={s.feedbackCard}>
                <View style={s.feedbackHeader}>
                  {userPick === activeQuestion.correctIndex ? (
                    <View style={s.correctBadge}>
                      <CheckCircle2 size={16} color="#15803d" />
                      <Text style={s.correctBadgeText}>Correct! Well done</Text>
                    </View>
                  ) : (
                    <View style={s.incorrectBadge}>
                      <XCircle size={16} color="#b91c1c" />
                      <Text style={s.incorrectBadgeText}>Incorrect answer</Text>
                    </View>
                  )}
                </View>
                <Text style={s.explanationText}>{activeQuestion.explanation}</Text>
              </View>
            )}

            <View style={s.navButtons}>
              {currentIdx > 0 && (
                <Pressable
                  style={s.prevButton}
                  onPress={() => setCurrentIdx(prev => prev - 1)}
                >
                  <Text style={s.prevButtonText}>Previous</Text>
                </Pressable>
              )}

              {currentIdx < filteredQuestions.length - 1 ? (
                <Pressable
                  style={[s.nextButton, userPick === undefined && s.nextButtonDisabled]}
                  disabled={userPick === undefined}
                  onPress={() => setCurrentIdx(prev => prev + 1)}
                >
                  <Text style={s.nextButtonText}>Next Question →</Text>
                </Pressable>
              ) : (
                <Pressable
                  style={[s.finishButton, userPick === undefined && s.nextButtonDisabled]}
                  disabled={userPick === undefined}
                  onPress={() => setIsFinished(true)}
                >
                  <Text style={s.finishButtonText}>Complete Test →</Text>
                </Pressable>
              )}
            </View>
          </>
        ) : (
          <View style={s.resultsCard}>
            <View style={[s.scoreCircle, passed ? s.scoreCirclePass : s.scoreCircleFail]}>
              <Award size={36} color={passed ? "#15803d" : "#b91c1c"} />
              <Text style={[s.scorePercent, passed ? s.scorePass : s.scoreFail]}>
                {percentage}%
              </Text>
            </View>

            <Text style={s.resultsTitle}>
              {passed ? "K53 Simulator Passed!" : "Needs More Practice"}
            </Text>
            <Text style={s.resultsSubtitle}>
              {passed
                ? "Excellent road knowledge! You reached the official 80% pass threshold required for South African driving licences."
                : "You scored below the 80% pass mark. Review the rules and retake the test to master the K53 competencies."}
            </Text>

            <View style={s.scoreBreakdown}>
              <View style={s.breakdownRow}>
                <Text style={s.breakdownLabel}>Correct answers</Text>
                <Text style={s.breakdownValue}>{score} of {filteredQuestions.length}</Text>
              </View>
              <View style={s.breakdownRow}>
                <Text style={s.breakdownLabel}>Passing score requirement</Text>
                <Text style={s.breakdownValue}>80%</Text>
              </View>
              <View style={s.breakdownRow}>
                <Text style={s.breakdownLabel}>Official standard</Text>
                <Text style={s.breakdownValue}>South African K53</Text>
              </View>
            </View>

            <Pressable style={s.retakeButton} onPress={restartQuiz}>
              <RotateCcw size={16} color="white" />
              <Text style={s.retakeButtonText}>Retake Practice Test</Text>
            </Pressable>

            <Pressable style={s.backToLearnerBtn} onPress={() => router.push("/learner")}>
              <Text style={s.backToLearnerText}>Back to Learner Home</Text>
            </Pressable>
          </View>
        )}
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
  categoryBar: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  catChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: "white",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#e4e6df",
  },
  catChipActive: { backgroundColor: "#244b38", borderColor: "#244b38" },
  catChipText: { fontSize: 11, color: "#546053", fontWeight: "600" },
  catChipTextActive: { color: "white" },
  progressRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  progressText: { fontSize: 12, fontWeight: "700", color: "#617260" },
  categoryBadge: {
    fontSize: 10,
    fontWeight: "700",
    color: "#244b38",
    backgroundColor: "#e8f1e6",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  questionCard: {
    backgroundColor: "white",
    padding: 18,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e6e8e2",
    marginBottom: 14,
  },
  questionText: { fontSize: 15, fontWeight: "700", color: "#1e2920", lineHeight: 22 },
  optionsContainer: { gap: 10, marginBottom: 16 },
  optionCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "white",
    padding: 14,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: "#e6e8e2",
    gap: 12,
  },
  optionCorrect: { backgroundColor: "#f0fdf4", borderColor: "#22c55e" },
  optionIncorrect: { backgroundColor: "#fef2f2", borderColor: "#ef4444" },
  optionBullet: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#f0f2ed",
    alignItems: "center",
    justifyContent: "center",
  },
  optionBulletText: { fontSize: 12, fontWeight: "700", color: "#314334" },
  optionText: { fontSize: 13, color: "#2d382e", flex: 1, lineHeight: 18 },
  feedbackCard: {
    backgroundColor: "white",
    padding: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e2e6dc",
    marginBottom: 16,
  },
  feedbackHeader: { marginBottom: 6 },
  correctBadge: { flexDirection: "row", alignItems: "center", gap: 6 },
  correctBadgeText: { fontSize: 13, fontWeight: "700", color: "#15803d" },
  incorrectBadge: { flexDirection: "row", alignItems: "center", gap: 6 },
  incorrectBadgeText: { fontSize: 13, fontWeight: "700", color: "#b91c1c" },
  explanationText: { fontSize: 12, color: "#505c4f", lineHeight: 18 },
  navButtons: { flexDirection: "row", gap: 10, marginTop: 4 },
  prevButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: "white",
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#d8ded4",
  },
  prevButtonText: { fontSize: 12, fontWeight: "600", color: "#425042" },
  nextButton: {
    flex: 1,
    paddingVertical: 12,
    backgroundColor: "#244b38",
    borderRadius: 6,
    alignItems: "center",
  },
  nextButtonDisabled: { opacity: 0.5 },
  nextButtonText: { fontSize: 12, fontWeight: "700", color: "white" },
  finishButton: {
    flex: 1,
    paddingVertical: 12,
    backgroundColor: "#d57c4e",
    borderRadius: 6,
    alignItems: "center",
  },
  finishButtonText: { fontSize: 12, fontWeight: "700", color: "white" },
  resultsCard: {
    backgroundColor: "white",
    padding: 26,
    borderRadius: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#e6e8e2",
  },
  scoreCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
    borderWidth: 4,
  },
  scoreCirclePass: { borderColor: "#22c55e", backgroundColor: "#f0fdf4" },
  scoreCircleFail: { borderColor: "#ef4444", backgroundColor: "#fef2f2" },
  scorePercent: { fontSize: 24, fontWeight: "800", marginTop: 4 },
  scorePass: { color: "#15803d" },
  scoreFail: { color: "#b91c1c" },
  resultsTitle: { fontSize: 20, fontWeight: "700", color: "#1d291e", marginBottom: 6 },
  resultsSubtitle: {
    fontSize: 12,
    color: "#636d62",
    textAlign: "center",
    lineHeight: 18,
    marginBottom: 20,
  },
  scoreBreakdown: { width: "100%", paddingVertical: 14, borderTopWidth: 1, borderTopColor: "#ecefe8" },
  breakdownRow: { flexDirection: "row", justifyContent: "space-between", marginVertical: 4 },
  breakdownLabel: { fontSize: 12, color: "#6e776d" },
  breakdownValue: { fontSize: 12, fontWeight: "700", color: "#222e23" },
  retakeButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#244b38",
    width: "100%",
    paddingVertical: 13,
    borderRadius: 6,
    marginTop: 16,
  },
  retakeButtonText: { color: "white", fontSize: 13, fontWeight: "700" },
  backToLearnerBtn: { marginTop: 12, padding: 8 },
  backToLearnerText: { fontSize: 12, color: "#4f5c4e", fontWeight: "600" },
});
