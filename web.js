const express = require('express');
const bodyParser = require('body-parser');
const initializeDatabase = require('./db');

console.log("initializeDatabase loaded from db.js");


const exportSurveyToExcel = require('./exportSurvey');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

async function predictFttAbnormality(data) {
  return new Promise((resolve, reject) => {
    // Path to the Python script and model files
    const pythonScript = path.join(__dirname, 'ftt_predictor.py');
    
    // Spawn Python process
    const pythonProcess = spawn('python3', [pythonScript]);
    
    let outputData = '';
    let errorData = '';
    
    // Collect data from stdout
    pythonProcess.stdout.on('data', (data) => {
      outputData += data.toString();
    });
    
    // Collect error messages from stderr
    pythonProcess.stderr.on('data', (data) => {
      errorData += data.toString();
      console.error('Python stderr:', data.toString());
    });
    
    // Handle process completion
    pythonProcess.on('close', (code) => {
      if (code !== 0) {
        console.error(`Python process exited with code ${code}`);
        console.error('Error output:', errorData);
        reject(new Error(`Python process failed with code ${code}: ${errorData}`));
        return;
      }
      
      try {
        // Parse the JSON output from Python
        const result = JSON.parse(outputData);
        
        if (result.success) {
          // Calculate ftt_weight based on abnormal status
          const abnormal = result.abnormal;
          const probability = result.probability;
          const ftt_weight = abnormal === 1 ? 3.5 : 0.6;
          
          // Return in the expected format for web.js
          resolve({
            success: true,
            abnormal,
            probability,
            ftt_weight,
            features_used: result.features_used
          });
        } else {
          // Handle prediction errors
          reject(new Error(`Prediction failed: ${result.error}`));
        }
      } catch (parseError) {
        console.error('Failed to parse Python output:', outputData);
        reject(new Error(`Failed to parse Python output: ${parseError.message}`));
      }
    });
    
    // Send input data to Python script via stdin
    pythonProcess.stdin.write(JSON.stringify(data));
    pythonProcess.stdin.end();
  });
}


let db;
initializeDatabase().then(pool => {
    db = pool;
    console.log('Database initialized successfully');
}).catch(error => {
    console.error('Failed to initialize database:', error);
});


const path = require('path');
const moment = require('moment');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 8001;

// [test] 로컬 테스트
current_state = `http://localhost:${PORT}`
// [live] 라이브
// current_state = 'http://kppdcalclpdn.cafe24app.com'

app.use(cors({
    origin: current_state,
    methods: ['GET', 'POST'], // Allowed HTTP methods
    allowedHeaders: ['Content-Type', 'Authorization'] // Allowed headers
}));


// Middleware
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public_html')));



// Serve the main.html file
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public_html/main.html');
});

  
  function sanitizeForJSON(obj) {
    if (obj === null || obj === undefined) {
      return obj;
    }
    
    if (typeof obj === 'bigint') {
      return obj.toString();
    }
    
    if (Array.isArray(obj)) {
      return obj.map(item => sanitizeForJSON(item));
    }
    
    if (typeof obj === 'object') {
      const newObj = {};
      for (const [key, value] of Object.entries(obj)) {
        newObj[key] = sanitizeForJSON(value);
      }
      return newObj;
    }
    
    return obj;
  }
  

  async function updateSurveyResponsesWide(surveyId, version) {
    try {
        // First check if a record already exists for this survey_id and version
        const [existingRecord] = await db.execute(
            'SELECT survey_id FROM survey_responses_wide WHERE survey_id = ? AND version = ?',
            [surveyId, version]
        );

        if (existingRecord.length > 0) {
            // Delete existing record to replace it
            await db.execute(
                'DELETE FROM survey_responses_wide WHERE survey_id = ? AND version = ?',
                [surveyId, version]
            );
        }

        // Get all answers for this survey
        const [answers] = await db.execute(
            'SELECT question_number, weight FROM survey_answers WHERE survey_id = ? AND version = ?',
            [surveyId, version]
        );

        // Get UPDRS weight
        const [updrsData] = await db.execute(
            'SELECT actual_weight FROM answers_updrs WHERE survey_id = ? AND version = ?',
            [surveyId, version]
        );
        
        // ADDED: Get FFT weight if available
        const [fftData] = await db.execute(
            'SELECT ftt_weight FROM fft_metadata WHERE survey_id = ? AND version = ? ORDER BY created_at DESC LIMIT 1',
            [surveyId, version]
        );
        
        // Create columns for the SQL query
        let columns = ['survey_id', 'version'];
        let values = [surveyId, version];
        let placeholders = ['?', '?'];
        
        // Add question weights to columns and values
        answers.forEach(answer => {
            columns.push(`q${answer.question_number}`);
            values.push(answer.weight);
            placeholders.push('?');
        });
        
        // Add UPDRS weight if available
        if (updrsData.length > 0) {
            columns.push('updrs_weight');
            values.push(updrsData[0].actual_weight);
            placeholders.push('?');
        }
        
        // ADDED: Add FFT weight if available
        if (fftData.length > 0) {
            columns.push('ftt_weight');
            values.push(fftData[0].ftt_weight);
            placeholders.push('?');
        }
        
        // Build and execute the INSERT query
        const insertQuery = `
            INSERT INTO survey_responses_wide (${columns.join(', ')}) 
            VALUES (${placeholders.join(', ')})
        `;
        
        await db.execute(insertQuery, values);
        console.log(`Updated survey_responses_wide for survey_id ${surveyId}, version ${version}`);
        
    } catch (error) {
        console.error('Error updating survey_responses_wide:', error);
        // Don't throw error - we don't want to disrupt the main flow if this fails
    }
}

// Endpoint to handle start calculation

app.post('/start-Questionnaire/q/:qnum', async (req, res) => {
    const { name, age, sex, id,underlyingConditions } = req.body;
    const qnum = parseInt(req.params.qnum);
    console.log(`Received request to start questionnaire with qnum: ${qnum}, name: ${name}, age: ${age}, sex: ${sex}, underlyingConditions: ${underlyingConditions},id :${id}`);
    try {

        let surveyId;
        if (qnum === 0) {
          // Combine underlyingConditions array with udelse
          const [existingRows] = await db.execute(
            'SELECT version FROM survey_responses WHERE id = ? ORDER BY version DESC LIMIT 1',
            [id]
        );

        // Calculate new version number
            const newVersion = existingRows.length > 0 ? existingRows[0].version + 1 : 1;

            let underlyingString = Array.isArray(underlyingConditions) 
                ? underlyingConditions.join(',') 
                : underlyingConditions || '';
            
            // Insert new survey response with version
            await db.execute(
                'INSERT INTO survey_responses (name, age, sex, underlying, id, version, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
                [name, age, sex, underlyingString, id, newVersion]
            );            
            
            surveyId = id;
        } else {
            surveyId = id;
        }


         console.log('index:', req.params.qnum);
        const index = req.params.qnum==0 ? 1 : req.params.qnum; 
        console.log('index:', index);
        // Get the question based on question_number
        const [rows] = await db.execute(
            'SELECT question_number, question_text, choice_yes_weight, choice_no_weight, choice_notsure_weight FROM questions WHERE question_number = ?', 
            [index]
        );
         console.log('SELECT new survey response:', rows[0]);
        const question = rows[0];

        let choices;
        if (question.question_number === 6) {
            choices = {
                '네': question.choice_yes_weight,
                '한번도 안피움': question.choice_no_weight,
                '끊었음': question.choice_notsure_weight
            };
        } else {
            choices = {
                '네': question.choice_yes_weight,
                '아니오': question.choice_no_weight,
                '모름': question.choice_notsure_weight
            };
        }

        // Return the survey ID, first question, and choices
        res.json({ 
            surveyId, 
            qnum: question.question_number, 
            question: question.question_text, 
            choices: choices
        });
     //   displayQuestion(data);
    } catch (error) {
        console.error('Error starting survey and getting question:', error);
        res.status(500).json({ error: 'Failed to start survey and get first question' });
    }
});


// Save Response and Get Next Question
app.post('/nextPage', async (req, res) => {
    const { surveyId, qnum, choices } = req.body;
    try {
        let nextQnum = qnum + 1;

        // Get the current version first
        const [versionInfo] = await db.execute(
            'SELECT version FROM survey_responses WHERE id = ? ORDER BY version DESC LIMIT 1',
            [surveyId]
        );
        const currentVersion = versionInfo[0].version;

        // Special case for question 8
        if (qnum === 8) {
            const answer = choices.find(choice => choice.questionNumber === 8);
            if (answer) {
                if (answer.choice === '네') {
                    // If answer is '네', proceed to question 9
                    nextQnum = 9;
                } else {
                    // If answer is '아니오' or '모름', skip to question 10 and save weight as 1
                    // await db.execute(
                    //     'INSERT INTO survey_answers (survey_id, question_number, choice, weight, version) VALUES (?, ?, ?, ?, ?)',
                    //     [surveyId, 8, answer.choice, 1, currentVersion]
                    // );
                    // // Also insert a default weight of 1 for skipped question 9
                    // await db.execute(
                    //     'INSERT INTO survey_answers (survey_id, question_number, choice, weight, version) VALUES (?, ?, ?, ?, ?)',
                    //     [surveyId, 9, 'SKIPPED', 1, currentVersion]
                    // );
                    nextQnum = 10;
                }
            }
        }
    
        // Handle Question 18-19 logic
        if (qnum === 18) {
            const answer = choices.find(choice => choice.questionNumber === 18);
            if (answer) {
                if (answer.choice === '아니오' || answer.choice === '모름') {
                    
                    nextQnum = 20;
                } else if (answer.choice === '네') {
                    nextQnum = 19;
                }
            }
        } else if (qnum === 19) {
                nextQnum = 20;
        }    

    if (nextQnum <= 22) {
            // Fetch next regular question (including 22)
            const [nextQuestionRows] = await db.execute('SELECT question_number, question_text, choice_yes_weight, choice_no_weight, choice_notsure_weight FROM questions WHERE question_number = ?', [nextQnum]);

            if (nextQuestionRows.length === 0) {
                return res.json({ completed: true, message: 'Survey completed' });
            }
            const nextQuestion = nextQuestionRows[0];
            let choices;

            // Special case for question 6
            if (nextQuestion.question_number === 6) {
                choices = {
                    '네': nextQuestion.choice_yes_weight,
                    '한번도 안피움': nextQuestion.choice_no_weight,
                    '끊었음': nextQuestion.choice_notsure_weight
                };
            } else {
                choices = {
                    '네': nextQuestion.choice_yes_weight,
                    '아니오': nextQuestion.choice_no_weight,
                    '모름': nextQuestion.choice_notsure_weight
                };
            }

            res.json({ 
                qnum: nextQnum,
                question: nextQuestion.question_text,
                choices: choices,
                isLastQuestion: nextQnum === false
            });
        
            } else if (nextQnum === 23) {
            // Fetch UPDRS questions
            const [updrsQuestions] = await db.execute('SELECT question_index, main_q_text, choice_yes_weight FROM questions_updrs');

            res.json({ 
                qnum: nextQnum,
                question: "다음 중 해당하는 증상들을 모두 골라주세요.",
                subtext: "없으시다면 바로 결과보기를 눌러주세요.",
                updrsQuestions: updrsQuestions,
                isLastQuestion: true
            });
        } else {
            res.json({ completed: true, message: 'Survey completed' });
        }
    } catch (error) {
        console.error('Error processing next page:', error);
        res.status(500).json({ error: 'Failed to process next page', details: error.message  });
    }
});

app.post('/prevPage', async (req, res) => {
    const { surveyId, qnum } = req.body;
    try {
        let prevQnum = qnum - 1;


                // Get the current version first
        const [versionInfo] = await db.execute(
                    'SELECT version FROM survey_responses WHERE id = ? ORDER BY version DESC LIMIT 1',
                    [surveyId]
                );
        const currentVersion = versionInfo[0].version;

        // Special case for question 10 (it might have skipped 9)
        if (qnum === 10) {
            prevQnum = 8;
        }

        // Special case for question 20 (it might have skipped 19)
        if (qnum === 20) {
            const [prevAnswers] = await db.execute(
                'SELECT choice FROM survey_answers WHERE survey_id = ? AND question_number = ? AND version = ? ORDER BY version DESC LIMIT 1',
                [surveyId, 18, currentVersion]
            );
            
            if (prevAnswers && prevAnswers.length > 0 && prevAnswers[0].choice === '네') {
                prevQnum = 19;  // Go back to 19 only if 18 was '네'
            } else {
                prevQnum = 18;  // Otherwise go back to 18
            }
        }

        // Fetch the previous question
        const [prevQuestionRows] = await db.execute('SELECT question_number, question_text, choice_yes_weight, choice_no_weight, choice_notsure_weight FROM questions WHERE question_number = ?', [prevQnum]);

        if (prevQuestionRows.length === 0) {
            return res.status(400).json({ error: 'No previous question available' });
        }

        const prevQuestion = prevQuestionRows[0];
        let choices;

        // Special case for question 6
        if (prevQuestion.question_number === 6) {
            choices = {
                '네': prevQuestion.choice_yes_weight,
                '한번도 안피움': prevQuestion.choice_no_weight,
                '끊었음': prevQuestion.choice_notsure_weight
            };
        } else {
            choices = {
                '네': prevQuestion.choice_yes_weight,
                '아니오': prevQuestion.choice_no_weight,
                '모름': prevQuestion.choice_notsure_weight
            };
        }

        res.json({ 
            qnum: prevQnum,
            question: prevQuestion.question_text,
            choices: choices,
            isLastQuestion: false
        });

    } catch (error) {
        console.error('Error processing previous page:', error);
        res.status(500).json({ error: 'Failed to process previous page' });
    }
});

app.post('/submitAnswers', async (req, res) => {
    const { surveyId, answers } = req.body;
    try {
        const [versionInfo] = await db.execute(
            'SELECT version FROM survey_responses WHERE id = ? ORDER BY version DESC LIMIT 1',
            [surveyId]
        );
        const currentVersion = versionInfo[0].version;

        // Process regular questions (1-22)
        for (let i = 1; i <= 22; i++) {
            const currentAnswer = answers.find(a => a.questionNumber === i);
            if (!currentAnswer) continue;

            let weight = currentAnswer.weight;

            // Special case handling for Q18-19
            if (i === 18) {
                // Find both Q18 and Q19 answers first
                const q18Answer = currentAnswer;
                const q19Answer = answers.find(a => a.questionNumber === 19);
                
                // Log the state for debugging
                console.log('Q18 answer:', q18Answer);
                console.log('Q19 answer:', q19Answer);
            
                if (q18Answer.choice === '아니오' || q18Answer.choice === '모름') {
                    // Case: Q18 is '아니오' or '모름'
                    await db.execute(
                        'INSERT INTO survey_answers (survey_id, question_number, choice, weight, version) VALUES (?, ?, ?, ?, ?)',
                        [surveyId, 18, q18Answer.choice, 0.8, currentVersion]
                    );
                    
                    await db.execute(
                        'INSERT INTO survey_answers (survey_id, question_number, choice, weight, version) VALUES (?, ?, ?, ?, ?)',
                        [surveyId, 19, 'SKIPPED', 1, currentVersion]
                    );
                    i++; // Skip Q19
                    continue;
                } else if (q18Answer.choice === '네' && q19Answer) {
                    // Case: Q18 is '네' and Q19 exists
                    let finalWeight;
                    if (q19Answer.choice === '네') {
                        finalWeight = 3.2;
                    } else if (q19Answer.choice === '아니오') {
                        finalWeight = 18.5;
                    } else {
                        finalWeight = 1;
                    }
                    
                    await db.execute(
                        'INSERT INTO survey_answers (survey_id, question_number, choice, weight, version) VALUES (?, ?, ?, ?, ?)',
                        [surveyId, 18, '네', 1, currentVersion]
                    );
                    
                    await db.execute(
                        'INSERT INTO survey_answers (survey_id, question_number, choice, weight, version) VALUES (?, ?, ?, ?, ?)',
                        [surveyId, 19, q19Answer.choice, finalWeight, currentVersion]
                    );
                    i++; // Skip Q19 since we've handled it
                    continue;
                }
            }
                                                // Special case for Q8-9
            else if (i === 8) {
                if (currentAnswer.choice === '네') {
                    await db.execute(
                        'INSERT INTO survey_answers (survey_id, question_number, choice, weight, version) VALUES (?, ?, ?, ?, ?)',
                        [surveyId, 8, currentAnswer.choice, weight, currentVersion]
                    );
                } else {
                    await db.execute(
                        'INSERT INTO survey_answers (survey_id, question_number, choice, weight, version) VALUES (?, ?, ?, ?, ?)',
                        [surveyId, 8, currentAnswer.choice, 1, currentVersion]
                    );
                    await db.execute(
                        'INSERT INTO survey_answers (survey_id, question_number, choice, weight, version) VALUES (?, ?, ?, ?, ?)',
                        [surveyId, 9, 'SKIPPED', 1, currentVersion]
                    );
                    i++; // Skip Q9
                    continue;
                }
            }
            else {
                // Regular questions - save with standard weight
                await db.execute(
                    'INSERT INTO survey_answers (survey_id, question_number, choice, weight, version) VALUES (?, ?, ?, ?, ?)',
                    [surveyId, i, currentAnswer.choice, weight, currentVersion]
                );
            }
        }

        // Handle UPDRS questions (Q23)
        const updrsChoices = answers.filter(answer => answer.questionNumber === 23);
        if (updrsChoices.length > 0) {
            const choiceIndexes = updrsChoices.map(choice => choice.choice).join(',');
            let totalWeight = updrsChoices.reduce((sum, choice) => sum + parseFloat(choice.weight), 0);
            const actual_weight = totalWeight < 2 ? 1 : 1;

            await db.execute(
                'INSERT INTO answers_updrs (survey_id, choices, weights, actual_weight, version) VALUES (?, ?, ?, ?, ?)',
                [surveyId, choiceIndexes, totalWeight, actual_weight, currentVersion]
            );
        } else {
            // If no UPDRS choices are made and confirmed through the frontend, set actual_weight to 1
            await db.execute(
                'INSERT INTO answers_updrs (survey_id, choices, weights, actual_weight, version) VALUES (?, ?, ?, ?, ?)',
                [surveyId, "", 0, 1, currentVersion]
            );
        }
        
        await updateSurveyResponsesWide(surveyId, currentVersion);

        // Return success with redirection information
        res.json({ 
            success: true, 
            message: 'Survey completed successfully',
            // redirect: `/resultsPage?surveyId=${surveyId}`
        });
    } catch (error) {
        console.error('Error submitting survey:', error);
        res.status(500).json({ error: 'Failed to submit survey', details: error.message });
    }
});


app.post('/submitConsent', async (req, res) => {
    const { surveyId, privacyConsent, consent1, consent2, consent3, consent4, consent5, consent6 } = req.body;

    if (!surveyId || !privacyConsent) {
        return res.status(400).json({ error: 'Missing required consent data.' });
    }

    try {
        const [versionInfo] = await db.execute(
            'SELECT version FROM survey_responses WHERE id = ? ORDER BY version DESC LIMIT 1',
            [surveyId]
        );
        const currentVersion = versionInfo[0].version;

        await db.execute(
            'INSERT INTO survey_consent (survey_id, version, privacy_consent, consent1, consent2, consent3, consent4, consent5, consent6, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
            [surveyId, currentVersion, privacyConsent, consent1 ? 1 : 0, consent2 ? 1 : 0, consent3 ? 1 : 0, consent4 ? 1 : 0, consent5 ? 1 : 0, consent6 ? 1 : 0]
        );

        res.json({ success: true, message: 'Consent data saved successfully.' });
    } catch (error) {
        console.error('Error saving consent data:', error);
        res.status(500).json({ error: 'Failed to save consent data.' });
    }
});

app.post('/submitTap', async (req, res) => {
    const { surveyId, primaryHand, x, y, time, screenWidth, screenHeight, boxType: clientBoxType, validity: clientValidity } = req.body;
  
    if (!surveyId || x === undefined || y === undefined || !time) {
      console.log("Validation failed:", { surveyId, x, y, time });
      return res.status(400).json({ error: "Missing required tap data." });
    }
  
    try {
      // Get the latest version number for this survey
      const [versionInfo] = await db.execute(
        'SELECT version FROM survey_responses WHERE id = ? ORDER BY version DESC LIMIT 1',
        [surveyId]
      );
      console.log("Retrieved version info:", versionInfo);
      const currentVersion = versionInfo[0].version;
    // Use client-provided validity if available, otherwise determine it server-side
      const validityToUse = clientValidity !== undefined ? clientValidity : 0;
      const boxTypeToUse = clientBoxType || "outside";      
  
      // Insert tap data into the database
      await db.execute(
        'INSERT INTO fft_data (survey_id, primaryHand, x, y, validity, box_type, time, version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())',
        [surveyId, primaryHand, x, y, validityToUse, boxTypeToUse, time, currentVersion]
      );

  
      res.json({ 
        success: true, 
        message: "Tap data saved successfully.", 
        validity: validityToUse, 
        boxType: boxTypeToUse
      });
    } catch (error) {
      console.error("Error saving tap data:", error);
      res.status(500).json({ error: "Failed to save tap data." });
    }
  });
  
  // Endpoint to calculate and store tap metadata after test ends
  app.post('/submitMetadata', async (req, res) => {
    const { surveyId, primaryHand } = req.body;
    if (!surveyId) {
      return res.status(400).json({ error: "Missing survey ID." });
    }
  
    try {
      // Get the latest version for this survey
      const [versionInfo] = await db.execute(
        'SELECT version FROM survey_responses WHERE id = ? ORDER BY version DESC LIMIT 1',
        [surveyId]
      );
      const currentVersion = versionInfo[0].version;
      
      // Fetch valid tap data
      const [rows] = await db.execute(
        'SELECT time, x, y, box_type FROM fft_data WHERE survey_id = ? AND version = ? AND validity = 1 ORDER BY time ASC',
        [surveyId, currentVersion]
      );
      
      if (rows.length < 4) {
        return res.status(400).json({ error: "Not enough valid taps to calculate metadata." });
      }
      
      // Store tap positions for feature calculation
      let tapPositions = rows.map(row => ({
        time: row.time,
        x: row.x,
        y: row.y,
        box_type: row.box_type
      }));
      
      // Calculate tap intervals (focus on every other tap to get full cycles)
      let tapIntervals = [];
      for (let i = 1; i < rows.length; i++) {
        let interval = (rows[i].time - rows[i - 1].time) / 1000; // Convert to seconds
        tapIntervals.push(Number(interval.toFixed(4)));
      }  
      if (tapIntervals.length === 0) {
        return res.status(400).json({ error: "Not enough valid tap intervals to calculate." });
      }
  
      // Calculate basic metrics
      let meantap_inter = tapIntervals.reduce((a, b) => parseFloat(a) + parseFloat(b), 0) / tapIntervals.length;
      let mediantap_inter = tapIntervals.sort((a, b) => a - b)[Math.floor(tapIntervals.length / 2)];
      let stddev = Math.sqrt(tapIntervals.map(t => Math.pow(t - meantap_inter, 2)).reduce((a, b) => a + b, 0) / tapIntervals.length);
      let cvtap_inter = meantap_inter > 0 ? (stddev / meantap_inter) * 100 : null;
  
      // Prepare data for abnormality prediction
      const tapData = {
        tap_intervals: tapIntervals,
        tap_positions: tapPositions,
        meantap_inter,
        mediantap_inter,
        cvtap_inter,
        total_taps: rows.length
      };
  
      let abnormal = 0;
      let abnormal_probability = 0;
      let ftt_weight = 1.0;  // Default weight is neutral
  
      try {
        const prediction = await predictFttAbnormality(tapData);
        console.log("Prediction result:", prediction);
        
        if (prediction.success) {
          abnormal = prediction.abnormal;
          abnormal_probability = typeof prediction.probability === 'bigint' 
            ? Number(prediction.probability) 
            : prediction.probability;
            
          // Set FFT weight based on abnormality
          ftt_weight = prediction.ftt_weight;
          console.log(`Setting ftt_weight to ${ftt_weight} based on abnormal status ${abnormal}`);
        } else {
          console.error("Prediction error:", prediction.error);
        }
      } catch (predError) {
        console.error("Failed to predict abnormality:", predError);
      }
  
      // Convert tap intervals to JSON for storage
      const tapIntervalsJson = JSON.stringify(tapIntervals);
      
      // Insert FFT metadata into the database
      await db.execute(
        'INSERT INTO fft_metadata (survey_id, version, total_taps, tap_intervals, cvtap_inter, meantap_inter, mediantap_inter, abnormal, abnormal_probability, ftt_weight, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
        [surveyId, currentVersion, rows.length, tapIntervalsJson, cvtap_inter, meantap_inter, mediantap_inter, abnormal, abnormal_probability, ftt_weight]
      );
      
      // Sanitize the response to handle any BigInt values
      const sanitizedResponse = sanitizeForJSON({
        success: true,
        message: "FFT metadata saved successfully.",
        abnormal,
        abnormal_probability
      });
      
      res.json(sanitizedResponse);
    } catch (error) {
      console.error("Error saving FFT metadata:", error);
      res.status(500).json({ error: "Failed to save FFT metadata." });
    }
  });
  
// Result Page: Calculate Total LR and Show Result
app.get('/resultsPage', async (req, res) => {
    const { surveyId, includeFTT } = req.query;  // Add includeFTT parameter

    try {
        
        // Get the latest version number for this survey
        const [versionInfo] = await db.execute(
            'SELECT version FROM survey_responses WHERE id = ? ORDER BY version DESC LIMIT 1',
            [surveyId]
        );
        const latestVersion = versionInfo[0].version;

        // Get survey information including sex and age for the latest version
        const [surveyInfo] = await db.execute(
            'SELECT age, sex FROM survey_responses WHERE id = ? AND version = ?',
            [surveyId, latestVersion]
        );

        console.log('Survey Info Raw:', surveyInfo);
        console.log('Survey Info Structure:', JSON.stringify(surveyInfo, null, 2));
        console.log('First Record:', surveyInfo[0]);
        
        // Calculate total LR for the survey from survey_answers
        const [rows] = await db.execute(`
            SELECT EXP(SUM(LOG(sa.weight))) as totalLR 
            FROM survey_answers sa
            WHERE sa.survey_id = ? AND sa.version = ?`,
            [surveyId, latestVersion]
        );

        // Initialize totalLR with the gender multiplier
        let totalLR = surveyInfo[0].sex === 'M' ? 1.2 : 0.8;
        
        // Multiply by the answer weights if we have any
        if (rows[0].totalLR !== null) {
            totalLR *= rows[0].totalLR;
            console.log('Base totalLR after answers:', totalLR);
        }

        console.log('totalLR after gender multiplier:', totalLR);    

        // Get UPDRS weight for the latest version
        const [updrsRows] = await db.execute(
            'SELECT actual_weight FROM answers_updrs WHERE survey_id = ? AND version = ?',
            [surveyId, latestVersion]
        );

        if (updrsRows.length > 0) {
            totalLR *= updrsRows[0].actual_weight;
            console.log('Applied UPDRS multiplier, final totalLR:', totalLR);
        }

        let fttResults = null;
        if (includeFTT === 'true') {
            // Get FFT data from fft_metadata table
            const [fttRows] = await db.execute(
                'SELECT total_taps, meantap_inter, mediantap_inter, cvtap_inter, abnormal, abnormal_probability, ftt_weight FROM fft_metadata WHERE survey_id = ? AND version = ? ORDER BY created_at DESC LIMIT 1',
                [surveyId, latestVersion]
            );
            
            if (fttRows.length > 0) {
                // Store FFT results for response
                fttResults = {
                    total_taps: fttRows[0].total_taps,
                    meantap_inter: fttRows[0].meantap_inter,
                    cvtap_inter: fttRows[0].cvtap_inter,
                    abnormal: fttRows[0].abnormal,
                    abnormal_probability: fttRows[0].abnormal_probability
                };
                
                totalLR *= fttRows[0].ftt_weight;
                console.log(`Applied FFT weight multiplier ${fttRows[0].ftt_weight}, new totalLR: ${totalLR}`);
            }
        }

        const age = surveyInfo[0].age;
        const { thresholdLR, priorProb } = determineThresholdLR(age);
        const priorOdds = priorProb / (1 - priorProb);
        const postOdds = priorOdds * totalLR;
        const postProb = postOdds / (1 + postOdds);
        
        // Convert to percentage for display
        const postProbPercentage = postProb * 100;
        const resultMessage = totalLR >= thresholdLR ? '정밀검사가 필요합니다' : '수치 상 안전할 가능성이 높습니다';

        res.json({ 
            totalLR, 
            thresholdLR,
            posteriorProbability: parseFloat(postProbPercentage.toFixed(2)),
            resultMessage 
        });
    } catch (error) {
        console.error('Error calculating total LR:', error);
        res.status(500).json({ error: 'Failed to calculate total LR' });
    }
});


function determineThresholdLR(age) {
    let thresholdLR, priorProb;
    
    if (age <= 54) {
        thresholdLR = 1000;
        priorProb = 0.004;
    } else if (age <= 59) {
        thresholdLR = 515;
        priorProb = 0.0075;
    } else if (age <= 64) {
        thresholdLR = 300;
        priorProb = 0.0125;
    } else if (age <= 69) {
        thresholdLR = 180;
        priorProb = 0.02;
    } else if (age <= 74) {
        thresholdLR = 155;
        priorProb = 0.025;
    } else if (age <= 79) {
        thresholdLR = 110;
        priorProb = 0.035;
    } else {
        thresholdLR = 95;
        priorProb = 0.04;
    }
    
    return { thresholdLR, priorProb };
}


app.get('/export-survey/:surveyId', async (req, res) => {
        const surveyId = req.params.surveyId;
        console.log('Received surveyId:', surveyId);
        console.log('Request params:', req.params);
        console.log('Request query:', req.query);
    
        if (!surveyId) {
            return res.status(400).json({ error: 'Invalid survey ID' });
        }

        try {
            const excelBuffer = await exportSurveyToExcel(db, surveyId);
    
            if (!excelBuffer) {
                console.error('Excel buffer is null or undefined for surveyId:', surveyId);
                throw new Error('Failed to generate Excel file');
            }
    
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename=survey_${surveyId}_${Date.now()}.xlsx`);
            res.send(excelBuffer);
        } catch (error) {
            console.error('Error exporting survey to Excel:', error);
            res.status(500).json({ error: 'Failed to export survey', details: error.message });
        }
    });


app.listen(PORT, '127.0.0.1', () => {
  console.log(`Server is running on ${PORT}`);
});