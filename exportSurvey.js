const xlsx = require('xlsx');

async function exportSurveyToExcel(db, surveyId) {
    try {
        console.log('Starting export for surveyId:', surveyId);
        
        // Get the latest version for this survey
        const [versionInfo] = await db.execute(
            'SELECT version FROM survey_responses WHERE id = ? ORDER BY version DESC LIMIT 1',
            [surveyId]
        );
        
        if (!versionInfo || versionInfo.length === 0) {
            throw new Error(`No version information found for survey ID: ${surveyId}`);
        }
        
        const latestVersion = versionInfo[0].version;
        console.log(`Using latest version: ${latestVersion} for survey ID: ${surveyId}`);

        // Fetch data from different tables with specific version
        const [surveyResponses] = await db.execute(
            'SELECT * FROM survey_responses WHERE id = ? AND version = ?', 
            [surveyId, latestVersion]
        );
        console.log('Survey Responses:', surveyResponses);

        const [surveyAnswers] = await db.execute(
            'SELECT * FROM survey_answers WHERE survey_id = ? AND version = ?', 
            [surveyId, latestVersion]
        );
        console.log('Survey Answers:', surveyAnswers);

        // Get general questions
        const [questions] = await db.execute('SELECT * FROM questions');

        // Get UPDRS questions and answers
        const [questionsUpdrs] = await db.execute('SELECT * FROM questions_updrs');
        const [answersUpdrs] = await db.execute(
            'SELECT * FROM answers_updrs WHERE survey_id = ? AND version = ?',
            [surveyId, latestVersion]
        );
        console.log('UPDRS Answers:', answersUpdrs);
        
        // Get FFT metadata
        const [fftMetadata] = await db.execute(
            'SELECT * FROM fft_metadata WHERE survey_id = ? AND version = ? ORDER BY created_at DESC LIMIT 1',
            [surveyId, latestVersion]
        );
        console.log('FFT Metadata:', fftMetadata);

        // Get consent data
        const [consentData] = await db.execute(
            'SELECT * FROM survey_consent WHERE survey_id = ? AND version = ?',
            [surveyId, latestVersion]
        );
        console.log('Consent Data:', consentData);

        // Get survey information
        const surveyInfo = surveyResponses[0];
        if (!surveyInfo) {
            throw new Error('Survey information not found');
        }
        
        // Calculate totalLR and posterior probability
        // Start with gender multiplier
        let totalLR = surveyInfo.sex === 'M' ? 1.2 : 0.8;
        
        // Calculate from survey answers
        const [lrRows] = await db.execute(
            `SELECT EXP(SUM(LOG(sa.weight))) as totalLR 
            FROM survey_answers sa
            WHERE sa.survey_id = ? AND sa.version = ?`,
            [surveyId, latestVersion]
        );
        
        // Multiply by the answer weights if we have any
        if (lrRows[0].totalLR !== null) {
            totalLR *= lrRows[0].totalLR;
        }
        
        // Apply UPDRS multiplier if available
        if (answersUpdrs.length > 0) {
            totalLR *= answersUpdrs[0].actual_weight;
        }
        
        // Apply FFT weight if available
        if (fftMetadata.length > 0) {
            totalLR *= fftMetadata[0].ftt_weight;
        }

        // Get age and calculate posterior probability
        const age = surveyInfo.age;
        const { thresholdLR, priorProb } = determineThresholdLR(age);
        const priorOdds = priorProb / (1 - priorProb);
        const postOdds = priorOdds * totalLR;
        const postProb = postOdds / (1 + postOdds);
        
        // Convert to percentage for display
        const postProbPercentage = postProb * 100;
        const resultMessage = totalLR >= thresholdLR ? '정밀검사가 필요합니다' : '수치 상 안전할 가능성이 높습니다';

        // Create workbook and worksheets
        const workbook = xlsx.utils.book_new();

        // Helper function to create a worksheet with a default message if data is empty
        function createWorksheet(data, sheetName) {
            if (!data || data.length === 0) {
                return xlsx.utils.json_to_sheet([{ message: `No data available for ${sheetName}` }]);
            }
            
            // Convert BigInt to string if present
            const processedData = data.map(item => {
                const newItem = {};
                for (const [key, value] of Object.entries(item)) {
                    if (typeof value === 'bigint') {
                        newItem[key] = value.toString();
                    } else if (value instanceof Date) {
                        newItem[key] = value.toISOString();
                    } else {
                        newItem[key] = value;
                    }
                }
                return newItem;
            });
            
            return xlsx.utils.json_to_sheet(processedData);
        }

        // Add sheets to workbook
        xlsx.utils.book_append_sheet(workbook, createWorksheet(surveyResponses, 'Survey Responses'), '기본 개인정보');

        // Add consent data sheet
        if (consentData && consentData.length > 0) {
            const consentFormatted = consentData.map(function(c) {
                return {
                    '설문ID': c.survey_id,
                    '버전': c.version,
                    '개인정보동의범위': c.privacy_consent,
                    '동의1': c.consent1 ? 'Y' : 'N',
                    '동의2': c.consent2 ? 'Y' : 'N',
                    '동의3': c.consent3 ? 'Y' : 'N',
                    '동의4': c.consent4 ? 'Y' : 'N',
                    '동의5': c.consent5 ? 'Y' : 'N',
                    '동의6': c.consent6 ? 'Y' : 'N',
                    '동의일시': c.created_at
                };
            });
            xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(consentFormatted), '동의서');
        } else {
            xlsx.utils.book_append_sheet(workbook, createWorksheet([], 'Consent'), '동의서');
        }

        xlsx.utils.book_append_sheet(workbook, createWorksheet(surveyAnswers, 'Survey Answers'), '설문 응답 내용');
        xlsx.utils.book_append_sheet(workbook, createWorksheet(questions, 'Questions'), '설문지 질문');
        xlsx.utils.book_append_sheet(workbook, createWorksheet(questionsUpdrs, 'UPDRS Questions'), 'UPDRS-8item 질문');
        xlsx.utils.book_append_sheet(workbook, createWorksheet(answersUpdrs, 'UPDRS Answers'), 'UPDRS-8item 응답내용');
        
        // Add FFT metadata sheet if available
        if (fftMetadata && fftMetadata.length > 0) {
            xlsx.utils.book_append_sheet(workbook, createWorksheet(fftMetadata, 'FFT Metadata'), '손가락 두드리기 검사 결과');
        }

        // Create final results sheet with posterior probability
        const finalResults = [{
            총우도비: totalLR.toFixed(2),
            위험점수: postProbPercentage.toFixed(2) + '%',
            결과메시지: resultMessage,
            나이: age,
            임계우도비: thresholdLR,
            설문ID: surveyId,
            버전: latestVersion,
            성별: surveyInfo.sex === 'M' ? '남성' : (surveyInfo.sex === 'F' ? '여성' : '기타'),
            기본확률: (priorProb * 100).toFixed(2) + '%',
            UPDRS점수: answersUpdrs.length > 0 ? answersUpdrs[0].actual_weight : 'N/A',
            손가락검사점수: fftMetadata.length > 0 ? fftMetadata[0].ftt_weight : 'N/A'
        }];
        xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(finalResults), '최종 결과');
        
        // Convert workbook to buffer
        const excelBuffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

        return excelBuffer;
    } catch (error) {
        console.error('Error exporting survey to Excel:', error);
        throw error;
    }
}

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

module.exports = exportSurveyToExcel;