const app = document.getElementById('app');

const state = {
  screen: 'home',
  currentModule: null,
  currentLevel: 0,
  currentQuestion: 0,
  score: 0,
  maxScore: 0,
  completedLevels: [],
  answerFeedback: '',
  answerStatus: null,
  selectedAnswer: null,
  questionCompleted: false,
  showHint: false,
  hintText: '',
};

function initializeModule(moduleIndex) {
  const module = modulesData[moduleIndex];
  state.currentModule = moduleIndex;
  state.currentLevel = 0;
  state.currentQuestion = 0;
  state.score = 0;
  state.maxScore = module.levels.reduce((sum, level) => sum + (level.questions?.length || 0), 0);
  state.completedLevels = [];
  state.answerFeedback = '';
  state.answerStatus = null;
  state.selectedAnswer = null;
  state.questionCompleted = false;
  state.showHint = false;
  state.hintText = '';
}

function render() {
  const module = state.currentModule !== null ? modulesData[state.currentModule] : null;
  let html = '';

  if (state.screen === 'home') {
    html = renderHome();
  } else if (state.screen === 'moduleIntro' && module) {
    html = renderModuleIntro(module);
  } else if (state.screen === 'concept' && module) {
    html = renderConcept(module);
  } else if (state.screen === 'question' && module) {
    html = renderQuestion(module);
  } else if (state.screen === 'levelComplete' && module) {
    html = renderLevelComplete(module);
  } else if (state.screen === 'moduleComplete' && module) {
    html = renderModuleComplete(module);
  } else {
    html = '<div class="page-card section-card"><h2>Something went wrong</h2><p>Try reloading the page and selecting a module again.</p></div>';
  }

  app.innerHTML = html;
}

function renderHome() {
  const totalQuestions = modulesData.reduce((sum, module) => sum + module.levels.reduce((s, level) => s + (level.questions?.length || 0), 0), 0);
  return `
    <div class="header-row">
      <div class="title-block">
        <h1>Cybersecurity Learning Portal</h1>
        <p>Choose a module, study the core concepts, and answer questions with guidance until you get the right answer.</p>
      </div>
      <div class="stats-pill">
        <span>8 Modules</span>
        <span>${totalQuestions} Questions</span>
      </div>
    </div>
    <div class="module-grid">
      ${modulesData.map((module, index) => {
        const questionCount = module.levels.reduce((sum, level) => sum + (level.questions?.length || 0), 0);
        return `
          <section class="module-card">
            <h2>${module.title}</h2>
            <p>${module.levels.length} levels, ${questionCount} questions.</p>
            <small>${module.levels[0].title} → ${module.levels[module.levels.length - 1].title}</small>
            <div class="button-row">
              <button class="button" onclick="selectModule(${index})">Open Module</button>
            </div>
          </section>
        `;
      }).join('')}
    </div>
    <footer>
      <p>Interactive cybersecurity training based on the Python module content.</p>
    </footer>
  `;
}

function renderModuleIntro(module) {
  return `
    <div class="header-row">
      <div class="title-block">
        <h1>${module.title}</h1>
        <p>Start the module to explore the concepts, then answer scenario-based questions. You can retry any question until you understand it.</p>
      </div>
      <div class="stats-pill">
        <span>${module.levels.length} Levels</span>
        <span>${state.maxScore} Questions</span>
      </div>
    </div>
    <div class="page-card section-card">
      <div class="tag"><span>Overview</span><span>${module.file}</span></div>
      <p>This module includes ${module.levels.length} learning levels. Each level begins with concept guidance, then quizzes you with multiple-choice items.</p>
      <div class="button-row">
        <button class="button" onclick="startLevel()">Begin Module</button>
        <button class="secondary-button" onclick="goHome()">Back to Modules</button>
      </div>
    </div>
  `;
}

function renderConcept(module) {
  const level = module.levels[state.currentLevel];
  const completed = state.completedLevels.length;
  return `
    <div class="header-row">
      <div class="title-block">
        <h1>${module.title}</h1>
        <p>Level ${state.currentLevel + 1}: ${level.title}</p>
      </div>
      <div class="stats-pill">
        <span>${completed}/${module.levels.length} Levels Completed</span>
        <span>${state.score}/${state.maxScore} Score</span>
      </div>
    </div>
    <div class="page-card section-card">
      <div class="tag"><span>Concept</span><span>${level.subtitle}</span></div>
      <h2>${level.concept?.title || level.title}</h2>
      <div class="pre-block">
        ${renderLines(level.concept?.lines || ['No concept details available.'])}
      </div>
      <div class="button-row">
        <button class="button" onclick="startQuestions()">Start Quiz</button>
        <button class="secondary-button" onclick="goHome()">Exit Module</button>
      </div>
    </div>
  `;
}

function renderQuestion(module) {
  const level = module.levels[state.currentLevel];
  const question = level.questions[state.currentQuestion];
  const total = level.questions.length;
  const subtitle = question.explanationBefore ? '<div class="feedback success"><strong>Background</strong><br />' + renderLines(question.explanationBefore) + '</div>' : '';
  const progressPercent = Math.round(((state.currentQuestion + 1) / total) * 100);
  const feedbackClass = state.answerStatus === 'correct' ? 'success' : state.answerStatus === 'incorrect' ? 'error' : '';
  const feedbackBlock = state.answerFeedback ? `<div class="feedback ${feedbackClass}">${state.answerFeedback}</div>` : '';
  const hintButton = question.hint ? `<button class="secondary-button" onclick="showHint()">Show Hint</button>` : '';
  const hintText = state.showHint ? `<div class="feedback success"><strong>Hint</strong><br />${question.hint}</div>` : '';
  const continueButton = state.questionCompleted ? `<button class="button" onclick="advanceQuestion()">Continue</button>` : '';
  return `
    <div class="header-row">
      <div class="title-block">
        <h1>${module.title}</h1>
        <p>Level ${state.currentLevel + 1}: ${level.title}</p>
      </div>
      <div class="stats-pill">
        <span>Question ${state.currentQuestion + 1}/${total}</span>
        <span>${state.score}/${state.maxScore} Score</span>
      </div>
    </div>
    <div class="progress-bar"><div class="progress-fill" style="width: ${progressPercent}%"></div></div>
    <div class="page-card section-card">
      <div class="tag"><span>Quiz</span><span>${level.subtitle}</span></div>
      <h2>${question.question}</h2>
      ${subtitle}
      <div class="button-row" style="flex-direction: column; gap: 14px; margin-top: 18px;">
        ${question.options.map((option, index) => {
          const classes = [];
          if (state.selectedAnswer === index) classes.push('selected');
          if (state.questionCompleted && index === question.correct) classes.push('correct');
          if (state.answerStatus === 'incorrect' && state.selectedAnswer === index) classes.push('incorrect');
          const disabled = state.questionCompleted ? 'disabled' : '';
          return `<button class="answer-button ${classes.join(' ')}" ${disabled} onclick="chooseAnswer(${index})">${option}</button>`;
        }).join('')}
      </div>
      ${feedbackBlock}
      ${hintText}
      <div class="button-row" style="margin-top: 22px;">
        ${hintButton}
        ${continueButton}
        <button class="secondary-button" onclick="goBackToConcept()">Back to Concept</button>
      </div>
    </div>
  `;
}

function renderLevelComplete(module) {
  const level = module.levels[state.currentLevel - 1];
  const hasNext = state.currentLevel < module.levels.length;
  return `
    <div class="header-row">
      <div class="title-block">
        <h1>${module.title}</h1>
        <p>Level completed: ${level.title}</p>
      </div>
      <div class="stats-pill">
        <span>${state.completedLevels.length}/${module.levels.length} Levels</span>
        <span>${state.score}/${state.maxScore} Score</span>
      </div>
    </div>
    <div class="page-card section-card">
      <h2>Great work!</h2>
      <p>You completed Level ${state.currentLevel}: ${level.title}</p>
      <div class="button-row">
        ${hasNext ? `<button class="button" onclick="nextLevel()">Continue to Level ${state.currentLevel + 1}</button>` : `<button class="button" onclick="completeModule()">Finish Module</button>`}
        <button class="secondary-button" onclick="goHome()">Exit Module</button>
      </div>
    </div>
  `;
}

function renderModuleComplete(module) {
  const completed = state.completedLevels.length;
  return `
    <div class="header-row">
      <div class="title-block">
        <h1>${module.title}</h1>
        <p>Module complete!</p>
      </div>
      <div class="stats-pill">
        <span>${completed}/${module.levels.length} Levels</span>
        <span>${state.score}/${state.maxScore} Score</span>
      </div>
    </div>
    <div class="page-card section-card">
      <h2>Mission Accomplished</h2>
      <p>You finished the module with <strong>${state.score}</strong> correct answers out of <strong>${state.maxScore}</strong>.</p>
      <div class="pre-block">
        ${renderLines(module.levels[module.levels.length - 1].concept?.lines || ['Review complete.'])}
      </div>
      <div class="button-row">
        <button class="button" onclick="goHome()">Select Another Module</button>
        <button class="secondary-button" onclick="restartModule()">Retry This Module</button>
      </div>
    </div>
  `;
}

function renderLines(lines) {
  return lines.map(line => `<p>${escapeHtml(line)}</p>`).join('');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function selectModule(index) {
  initializeModule(index);
  state.screen = 'moduleIntro';
  render();
}

function startLevel() {
  state.currentQuestion = 0;
  state.answerFeedback = '';
  state.answerStatus = null;
  state.selectedAnswer = null;
  state.questionCompleted = false;
  state.showHint = false;
  state.hintText = '';
  state.screen = 'concept';
  render();
}

function startQuestions() {
  state.answerFeedback = '';
  state.answerStatus = null;
  state.selectedAnswer = null;
  state.questionCompleted = false;
  state.showHint = false;
  state.hintText = '';
  state.screen = 'question';
  render();
}

function chooseAnswer(answerIndex) {
  if (state.questionCompleted) return;
  const level = modulesData[state.currentModule].levels[state.currentLevel];
  const question = level.questions[state.currentQuestion];
  const correctIndex = question.correct;
  state.selectedAnswer = answerIndex;
  if (answerIndex === correctIndex) {
    state.score += 1;
    state.answerFeedback = 'Correct — great work! Press Continue to move to the next question.';
    state.answerStatus = 'correct';
    state.questionCompleted = true;
    render();
    return;
  }

  const wrongEntries = question.wrongExplanations || {};
  const explanation = wrongEntries[(answerIndex + 1).toString()] || wrongEntries[answerIndex] || [];
  const message = Array.isArray(explanation) ? explanation.map(escapeHtml).join(' ') : escapeHtml(explanation);
  state.answerFeedback = message || 'That answer is not correct. Review the concept and try again.';
  state.answerStatus = 'incorrect';
  render();
}

function showHint() {
  const question = modulesData[state.currentModule].levels[state.currentLevel].questions[state.currentQuestion];
  state.hintText = question.hint || 'Review the concept and try to match the correct principle.';
  state.showHint = true;
  render();
}

function nextLevel() {
  state.answerFeedback = '';
  state.answerStatus = null;
  state.selectedAnswer = null;
  state.questionCompleted = false;
  state.showHint = false;
  state.hintText = '';
  state.screen = 'concept';
  render();
}

function completeModule() {
  state.screen = 'moduleComplete';
  render();
}

function restartModule() {
  initializeModule(state.currentModule);
  state.screen = 'moduleIntro';
  render();
}

function advanceQuestion() {
  const level = modulesData[state.currentModule].levels[state.currentLevel];
  if (state.currentQuestion < level.questions.length - 1) {
    state.currentQuestion += 1;
    state.answerFeedback = '';
    state.answerStatus = null;
    state.selectedAnswer = null;
    state.questionCompleted = false;
    state.showHint = false;
    state.hintText = '';
    render();
    return;
  }

  state.currentLevel += 1;
  state.completedLevels.push(state.currentLevel);
  state.answerFeedback = '';
  state.answerStatus = null;
  state.selectedAnswer = null;
  state.questionCompleted = false;
  state.showHint = false;
  state.hintText = '';
  state.screen = 'levelComplete';
  render();
}

function goBackToConcept() {
  state.screen = 'concept';
  render();
}

function goHome() {
  state.screen = 'home';
  state.currentModule = null;
  render();
}

render();
